import { RangeMp4Source } from '../src/decode/range-mp4-source.ts';
import { copyNativeYuvFrame } from '../src/decode/native-yuv.ts';
import { WebGL2Compositor } from '../src/compositor/webgl2.ts';
import { FrameMetrics } from '../src/metrics/collector.ts';

const visual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1,
};

function metadata(frame) {
  const rect = frame.visibleRect;
  const color = frame.colorSpace;
  return {
    format: frame.format,
    codedWidth: frame.codedWidth, codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth, displayHeight: frame.displayHeight,
    visibleRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    timestamp: frame.timestamp, duration: frame.duration,
    colorSpace: color ? {
      primaries: color.primaries, transfer: color.transfer,
      matrix: color.matrix, fullRange: color.fullRange,
    } : null,
  };
}

async function render(frame, scenario, path) {
  const compositor = new WebGL2Compositor(undefined, { uploadPath: path });
  const metrics = new FrameMetrics();
  const output = { width: scenario.width, height: scenario.height, colorSpace: 'bt709-limited' };
  const plan = {
    timeUs: frame.timestamp,
    base: [{
      id: scenario.key, source: { logicalSize: { width: scenario.width, height: scenario.height } },
      sourceTimeUs: frame.timestamp, visual,
    }],
    layers: [], transition: { type: 'hard-cut', progress: 0 }, output,
  };
  try {
    const surface = await compositor.compose([frame], [], output, metrics, plan);
    try { return await surface.readRgba(); }
    finally { surface.close(); }
  } finally {
    compositor.dispose();
  }
}

function compare(left, right) {
  if (left.length !== right.length) throw new Error(`composed sizes differ ${left.length}/${right.length}`);
  const max = [0, 0, 0, 0], totals = [0, 0, 0, 0];
  const pixels = left.length / 4;
  for (let i = 0; i < left.length; i++) {
    const channel = i % 4;
    const delta = Math.abs(left[i] - right[i]);
    max[channel] = Math.max(max[channel], delta);
    totals[channel] += delta;
  }
  return { max, mean: totals.map(total => total / pixels) };
}

// Reproduce the pre-fix copyTo path for evidence: copyTo() supplies visible rows,
// while this old path interprets that buffer as codedHeight (1088) rows.
async function copyBeforeVisibleRectFix(frame) {
  const width = frame.codedWidth, height = frame.codedHeight;
  const bytes = new Uint8Array(frame.allocationSize());
  const layouts = await frame.copyTo(bytes);
  const plane = (layout, rowWidth, rows) => {
    const output = new Uint8Array(rowWidth * rows);
    for (let row = 0; row < rows; row++) {
      const from = layout.offset + row * layout.stride;
      output.set(bytes.subarray(from, from + rowWidth), row * rowWidth);
    }
    return output;
  };
  const y = plane(layouts[0], width, height);
  const chromaWidth = Math.ceil(width / 2), chromaHeight = Math.ceil(height / 2);
  return frame.format === 'NV12'
    ? { format: 'NV12', width, height, y,
      uv: plane(layouts[1], chromaWidth * 2, chromaHeight) }
    : { format: 'I420', width, height, y,
      u: plane(layouts[1], chromaWidth, chromaHeight),
      v: plane(layouts[2], chromaWidth, chromaHeight) };
}

globalThis.runBaseDecoderPixels = async (baseUrl, scenarios) => {
  const offsetFrame = new VideoFrame(new Uint8Array(8 * 6 * 3 / 2), {
    format: 'I420', codedWidth: 8, codedHeight: 6,
    visibleRect: { x: 2, y: 2, width: 3, height: 3 }, timestamp: 0,
  });
  let oddVisibleRect;
  try {
    const cropped = await copyNativeYuvFrame(offsetFrame);
    oddVisibleRect = { width: cropped.width, height: cropped.height,
      yBytes: cropped.y.length, uBytes: cropped.u.length, vBytes: cropped.v.length };
  } finally { offsetFrame.close(); }
  const rows = [], warnings = {};
  let legacyCodedPadding;
  for (const scenario of scenarios) {
    warnings[scenario.key] = [];
    const source = new RangeMp4Source(scenario.key, `${baseUrl}/${scenario.key}`, {
      prefetch: true, hardwareAcceleration: 'no-preference',
      onWarning: warning => warnings[scenario.key].push(warning),
    });
    try {
      for (const number of scenario.frames) {
        const held = [];
        try {
          for (let frameNumber = number - 2; frameNumber <= number; frameNumber++) {
            held.push(await source.decode(Math.round(frameNumber * 1e6 / 30)));
          }
          const native = held.at(-1);
          const nativeCallerFramesBefore = source.callerDecoderFrames;
          const copied = await source.decode(Math.round(number * 1e6 / 30));
          const nativeCallerFramesAfter = source.callerDecoderFrames;
          held.push(copied);
          const nativeMeta = metadata(native), copiedMeta = metadata(copied);
          const samePhysical = ['format', 'codedWidth', 'codedHeight', 'displayWidth', 'displayHeight',
            'visibleRect', 'timestamp', 'duration', 'colorSpace']
            .every(key => JSON.stringify(nativeMeta[key]) === JSON.stringify(copiedMeta[key]));
          native.rotationDeg = source.meta.rotationDeg;
          copied.rotationDeg = source.meta.rotationDeg;
          const nativeDirect = await render(native, scenario, 'direct');
          const copiedDirect = await render(copied, scenario, 'direct');
          if (scenario.key === 'testsrc' && number === 236) {
            const legacy = await copyBeforeVisibleRectFix(native);
            const legacyImage = await render(legacy, scenario, 'copyTo');
            const bottom = (scenario.height - 1) * scenario.width * 4;
            legacyCodedPadding = {
              codedHeight: native.codedHeight, visibleHeight: native.visibleRect.height,
              ...compare(nativeDirect, legacyImage),
              directBottomPixel: [...nativeDirect.subarray(bottom, bottom + 4)],
              oldCopyBottomPixel: [...legacyImage.subarray(bottom, bottom + 4)],
            };
          }
          const nativePlanes = await copyNativeYuvFrame(native);
          const copiedPlanes = await copyNativeYuvFrame(copied);
          nativePlanes.rotationDeg = source.meta.rotationDeg;
          copiedPlanes.rotationDeg = source.meta.rotationDeg;
          const nativeYuv = await render(nativePlanes, scenario, 'copyTo');
          const copiedFallback = await render(copiedPlanes, scenario, 'copyTo');
          const base = {
            key: scenario.key, frame: number, acceleration: source.decoderAcceleration,
            rotationDeg: source.meta.rotationDeg, native: nativeMeta, copied: copiedMeta,
            nativeCallerFramesBefore, nativeCallerFramesAfter,
            metadataMatch: samePhysical,
          };
          rows.push({ ...base, path: 'direct', ...compare(nativeDirect, copiedDirect) });
          rows.push({ ...base, path: 'copyTo', ...compare(nativeYuv, copiedFallback) });
        } finally {
          for (const frame of held) frame.close();
        }
      }
    } finally { source.destroy(); }
  }
  return { rows, warnings, oddVisibleRect, legacyCodedPadding };
};
