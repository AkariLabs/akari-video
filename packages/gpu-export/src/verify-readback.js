export async function hashCanvasFrame(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) throw new Error("verification WebGL2 context is unavailable");
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readbackCanvasFrame(FE, frame, canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) throw new Error("GPU capture readback WebGL2 context is unavailable");
  const flipRows = (input) => {
    const stride = canvas.width * 4;
    const output = new Uint8Array(input.length);
    for (let row = 0; row < canvas.height; row += 1) {
      output.set(input.subarray(row * stride, (row + 1) * stride), (canvas.height - row - 1) * stride);
    }
    return output;
  };
  let captured = null;
  const surface = {
    canvas,
    width: canvas.width,
    height: canvas.height,
    async readRgba() {
      gl.finish();
      const raw = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      return flipRows(raw);
    },
    recordSink() {},
    close() {},
  };
  await FE.readbackFrame(
    { ...frame, surface },
    { write(rgba) { captured = rgba.slice(); } },
  );
  if (!(captured instanceof Uint8Array)) throw new Error("GPU capture readback returned no pixels");
  return captured;
}

export function createDomLayerSentinelVerifier(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) throw new Error("DOM layer sentinel verification WebGL2 context is unavailable");
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error("DOM layer sentinel verification resources are unavailable");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const bytes = new Uint8Array(4 * 4 * 4);
  return {
    verify(source, expected, tolerance = 8) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("DOM layer sentinel verification framebuffer is incomplete");
      }
      // With UNPACK_FLIP_Y_WEBGL disabled, source row 0 is texture row 0. Reading framebuffer
      // y=0 therefore samples the source canvas's top-left sentinel, matching SpriteCompositor.
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      const totals = [0, 0, 0];
      for (let index = 0; index < bytes.length; index += 4) {
        totals[0] += bytes[index];
        totals[1] += bytes[index + 1];
        totals[2] += bytes[index + 2];
      }
      const actual = totals.map((value) => Math.round(value / 16));
      return {
        actual,
        matched: actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance),
      };
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
}

const SPRITE_DRAW_SECTIONS = [
  "clear",
  "baseUpload",
  "baseDraw",
  "program",
  "bindTexture",
  "sampler",
  "uniform",
  "instanceUpload",
  "blend",
  "drawArrays",
  "flush",
];

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function timingStat() {
  return { count: 0, samples: [], frames: new Map() };
}

/** Verification-only GL timing probe compatible with SpriteCompositor.setDrawProbe(). */
export function createSpriteDrawTimingProbe(gl) {
  const extension = typeof gl.getExtension === "function"
    ? gl.getExtension("EXT_disjoint_timer_query_webgl2")
    : null;
  const timerQueries = Boolean(
    extension
      && typeof extension.TIME_ELAPSED_EXT === "number"
      && typeof extension.GPU_DISJOINT_EXT === "number"
      && typeof gl.createQuery === "function"
      && typeof gl.beginQuery === "function"
      && typeof gl.endQuery === "function"
      && typeof gl.getQueryParameter === "function",
  );
  const method = timerQueries ? "EXT_disjoint_timer_query_webgl2" : "gl.finish";
  const stats = new Map(SPRITE_DRAW_SECTIONS.map((label) => [label, timingStat()]));
  const pending = [];
  const shape = { plainDraws: 0, tileDraws: 0, tiles: 0 };
  let frames = 0;
  let frameIndex = -1;
  let selectedLabel = null;
  let timerQueryActive = false;

  function statFor(label) {
    let stat = stats.get(label);
    if (!stat) {
      stat = timingStat();
      stats.set(label, stat);
    }
    return stat;
  }

  function frameRecord(stat, index) {
    let record = stat.frames.get(index);
    if (!record) {
      record = { expected: 0, values: [], invalid: false };
      stat.frames.set(index, record);
    }
    return record;
  }

  function recordSample(stat, index, value) {
    stat.samples.push(value);
    frameRecord(stat, index).values.push(value);
  }

  function discardPendingQueries() {
    for (const item of pending) {
      frameRecord(item.stat, item.frameIndex).invalid = true;
      gl.deleteQuery?.(item.query);
    }
    pending.length = 0;
  }

  function collectQueries() {
    if (!timerQueries || pending.length === 0 || timerQueryActive) return;
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      discardPendingQueries();
      return;
    }
    let writeIndex = 0;
    for (const item of pending) {
      if (gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) {
        const elapsedNs = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        gl.deleteQuery?.(item.query);
        recordSample(item.stat, item.frameIndex, elapsedNs / 1e6);
      } else {
        pending[writeIndex] = item;
        writeIndex += 1;
      }
    }
    pending.length = writeIndex;
  }

  function measureWithTimer(stat, run) {
    collectQueries();
    const query = gl.createQuery();
    if (!query) {
      run();
      return;
    }
    const record = frameRecord(stat, frameIndex);
    record.expected += 1;
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    timerQueryActive = true;
    try {
      run();
    } finally {
      timerQueryActive = false;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push({ query, stat, frameIndex });
    }
  }

  function measureWithFinish(stat, run) {
    const record = frameRecord(stat, frameIndex);
    record.expected += 1;
    gl.finish();
    const started = performance.now();
    try {
      run();
    } finally {
      gl.finish();
      recordSample(stat, frameIndex, performance.now() - started);
    }
  }

  return {
    section(label, run) {
      const stat = statFor(label);
      stat.count += 1;
      if (!timerQueries) {
        measureWithFinish(stat, run);
        return;
      }
      if (label !== selectedLabel || timerQueryActive) {
        run();
        return;
      }
      measureWithTimer(stat, run);
    },
    frame(value) {
      collectQueries();
      frameIndex = frames;
      frames += 1;
      selectedLabel = SPRITE_DRAW_SECTIONS[frameIndex % SPRITE_DRAW_SECTIONS.length];
      shape.plainDraws += value.plainDraws;
      shape.tileDraws += value.tileDraws;
      shape.tiles += value.tiles;
    },
    summary() {
      collectQueries();
      const sections = {};
      for (const [label, stat] of stats) {
        const totals = [];
        for (const record of stat.frames.values()) {
          if (!record.invalid && record.expected > 0 && record.values.length === record.expected) {
            totals.push(record.values.reduce((sum, value) => sum + value, 0));
          }
        }
        sections[label] = {
          count: stat.count,
          totalMsPerFrame: percentile(totals, 0.5),
          p50: percentile(stat.samples, 0.5),
          p95: percentile(stat.samples, 0.95),
          mean: stat.samples.length === 0
            ? null
            : stat.samples.reduce((sum, value) => sum + value, 0) / stat.samples.length,
        };
      }
      return { method, frames, shape: { ...shape }, sections };
    },
  };
}
