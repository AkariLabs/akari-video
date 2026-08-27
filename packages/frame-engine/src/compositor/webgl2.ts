import type {
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  GPUFrameSurface,
  NativeYuvFrame,
  ResolvedCutVisual
} from '../types.js';

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 could not allocate a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader compile failure';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`missing WebGL2 uniform: ${name}`);
  return location;
}

function flipRows(input: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const output = new Uint8Array(input.length);
  for (let row = 0; row < height; row += 1) {
    output.set(input.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
  }
  return output;
}

class WebGLSurface implements GPUFrameSurface {
  private closed = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private readonly gl: WebGL2RenderingContext,
    private readonly metrics: FrameMetricsRecorder
  ) {}

  async readRgba(): Promise<Uint8Array> {
    if (this.closed) throw new Error('cannot read a closed GPU frame surface');
    const gl = this.gl;
    const byteLength = this.width * this.height * 4;
    const pbo = gl.createBuffer();
    if (!pbo) throw new Error('WebGL2 could not allocate a pixel pack buffer');
    const started = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
      throw new Error('WebGL2 could not allocate a readback fence');
    }
    gl.flush();
    const waitStarted = performance.now();
    try {
      const deadline = performance.now() + 15_000;
      while (true) {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
        if (status === gl.WAIT_FAILED) throw new Error('WebGL2 PBO fence wait failed');
        if (performance.now() >= deadline) throw new Error('WebGL2 PBO fence wait timed out');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      this.metrics.record('pboWait', performance.now() - waitStarted);
      const raw = new Uint8Array(byteLength);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
      const flipStarted = performance.now();
      const rgba = flipRows(raw, this.width, this.height);
      this.metrics.record('rowFlip', performance.now() - flipStarted);
      this.metrics.record('readback', performance.now() - started);
      return rgba;
    } finally {
      gl.deleteSync(fence);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
    }
  }

  recordSink(elapsedMs: number): void {
    this.metrics.record('sink', elapsedMs);
  }

  close(): void {
    this.closed = true;
  }
}

interface LayerUniforms {
  framing: WebGLUniformLocation;
  transform: WebGLUniformLocation;
  opacity: WebGLUniformLocation;
  format: WebGLUniformLocation;
  sourceSize: WebGLUniformLocation;
}

export interface WebGL2CompositorOptions {
  synchronization?: 'finish' | 'flush';
}

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 color;
uniform sampler2D y0;
uniform sampler2D u0;
uniform sampler2D v0;
uniform sampler2D y1;
uniform sampler2D u1;
uniform sampler2D v1;
uniform int format0;
uniform int format1;
uniform vec4 framing0;
uniform vec4 framing1;
uniform vec4 transform0;
uniform vec4 transform1;
uniform float opacity0;
uniform float opacity1;
uniform vec2 outputSize;
uniform vec2 sourceSize0;
uniform vec2 sourceSize1;
uniform int transitionType;
uniform float transitionProgress;

vec3 yuv709(float y, vec2 chroma) {
  y -= 16.0 / 255.0;
  float u = chroma.r - 0.5;
  float v = chroma.g - 0.5;
  return clamp(vec3(
    1.164383 * y + 1.792741 * v,
    1.164383 * y - 0.213249 * u - 0.532909 * v,
    1.164383 * y + 2.112402 * u
  ), 0.0, 1.0);
}

vec2 inverseVisual(vec2 p, vec4 transform, vec4 framing) {
  vec2 pixel = (p - 0.5) * outputSize - transform.xy;
  float angle = transform.w;
  pixel = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * pixel;
  pixel /= transform.z;
  vec2 local = pixel / outputSize + 0.5;
  return framing.xy + local * framing.zw;
}

vec2 canvasToSource(vec2 canvasPoint, vec2 sourceSize) {
  float fit = min(outputSize.x / sourceSize.x, outputSize.y / sourceSize.y);
  vec2 fitted = sourceSize * fit;
  vec2 offset = (outputSize - fitted) * 0.5;
  return (canvasPoint * outputSize - offset) / fitted;
}

vec4 sample0(vec2 p) {
  vec2 canvasPoint = inverseVisual(p, transform0, framing0);
  if (canvasPoint.x < framing0.x || canvasPoint.x > framing0.x + framing0.z || canvasPoint.y < framing0.y || canvasPoint.y > framing0.y + framing0.w) return vec4(0.0);
  vec2 q = canvasToSource(canvasPoint, sourceSize0);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  vec2 chroma = format0 == 1 ? texture(u0, q).rg : vec2(texture(u0, q).r, texture(v0, q).r);
  return vec4(yuv709(texture(y0, q).r, chroma), opacity0);
}

vec4 sample1(vec2 p) {
  vec2 canvasPoint = inverseVisual(p, transform1, framing1);
  if (canvasPoint.x < framing1.x || canvasPoint.x > framing1.x + framing1.z || canvasPoint.y < framing1.y || canvasPoint.y > framing1.y + framing1.w) return vec4(0.0);
  vec2 q = canvasToSource(canvasPoint, sourceSize1);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  vec2 chroma = format1 == 1 ? texture(u1, q).rg : vec2(texture(u1, q).r, texture(v1, q).r);
  return vec4(yuv709(texture(y1, q).r, chroma), opacity1);
}

vec3 overBlack(vec4 value) { return value.rgb * value.a; }

void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  vec4 outgoing = sample0(p);
  float amount = clamp(transitionProgress, 0.0, 1.0);
  vec3 result;
  if (transitionType == 0) {
    result = overBlack(outgoing);
  } else if (transitionType == 1) {
    vec4 incoming = sample1(p);
    result = mix(overBlack(outgoing), overBlack(incoming), amount);
  } else if (transitionType == 2 || transitionType == 3) {
    vec4 incoming = sample1(p);
    vec3 plate = transitionType == 3 ? vec3(1.0) : vec3(0.0);
    result = amount < 0.5
      ? mix(overBlack(outgoing), plate, amount * 2.0)
      : mix(plate, overBlack(incoming), (amount - 0.5) * 2.0);
  } else if (transitionType == 4) {
    vec4 incoming = sample1(p);
    result = p.y < amount ? overBlack(incoming) : overBlack(sample0(vec2(p.x, p.y - amount)));
  } else if (transitionType == 5) {
    vec4 incoming = sample1(p);
    result = p.y > 1.0 - amount ? overBlack(incoming) : overBlack(sample0(vec2(p.x, p.y + amount)));
  } else {
    result = overBlack(outgoing);
  }
  color = vec4(result, 1.0);
}`;

/** WebGL2 limited-range BT.709 compositor for cuts and two-input transitions. */
export class WebGL2Compositor implements CompositorBackend {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly textures: readonly WebGLTexture[];
  private readonly textureShapes: Array<string | null> = Array.from({ length: 6 }, () => null);
  private readonly layers: readonly LayerUniforms[];
  private readonly outputSize: WebGLUniformLocation;
  private readonly transitionType: WebGLUniformLocation;
  private readonly transitionProgress: WebGLUniformLocation;
  private secondaryInitialized = false;
  private disposed = false;

  constructor(
    canvas = document.createElement('canvas'),
    private readonly options: WebGL2CompositorOptions = {}
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 position;
      out vec2 uv;
      void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }
    `);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL2 could not allocate a program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 link failure');
    }
    gl.useProgram(program);
    this.program = program;
    const vertices = gl.createBuffer();
    if (!vertices) throw new Error('WebGL2 could not allocate a vertex buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    this.textures = Array.from({ length: 6 }, (_unused, unit) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('WebGL2 could not allocate a texture');
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
    ['y0', 'u0', 'v0', 'y1', 'u1', 'v1'].forEach((name, unit) => {
      gl.uniform1i(requiredUniform(gl, program, name), unit);
    });
    this.layers = [0, 1].map(index => ({
      framing: requiredUniform(gl, program, `framing${index}`),
      transform: requiredUniform(gl, program, `transform${index}`),
      opacity: requiredUniform(gl, program, `opacity${index}`),
      format: requiredUniform(gl, program, `format${index}`),
      sourceSize: requiredUniform(gl, program, `sourceSize${index}`)
    }));
    this.outputSize = requiredUniform(gl, program, 'outputSize');
    this.transitionType = requiredUniform(gl, program, 'transitionType');
    this.transitionProgress = requiredUniform(gl, program, 'transitionProgress');
  }

  private upload(unit: number, data: Uint8Array, width: number, height: number, channels = 1): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[unit] ?? null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const sourceFormat = channels === 2 ? gl.RG : gl.RED;
    const shape = `${width}x${height}x${channels}`;
    if (this.textureShapes[unit] === shape) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, sourceFormat, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, channels === 2 ? gl.RG8 : gl.R8, width, height, 0,
        sourceFormat, gl.UNSIGNED_BYTE, data);
      this.textureShapes[unit] = shape;
    }
  }

  private uploadFrame(frame: NativeYuvFrame, layer: number): void {
    const base = layer * 3;
    const chromaWidth = Math.ceil(frame.width / 2);
    const chromaHeight = Math.ceil(frame.height / 2);
    this.gl.uniform2f(this.layers[layer]!.sourceSize, frame.width, frame.height);
    this.upload(base, frame.y, frame.width, frame.height);
    if (frame.format === 'NV12') {
      this.upload(base + 1, frame.uv, chromaWidth, chromaHeight, 2);
      this.upload(base + 2, new Uint8Array([128]), 1, 1);
      this.gl.uniform1i(this.layers[layer]!.format, 1);
    } else {
      this.upload(base + 1, frame.u, chromaWidth, chromaHeight);
      this.upload(base + 2, frame.v, chromaWidth, chromaHeight);
      this.gl.uniform1i(this.layers[layer]!.format, 0);
    }
  }

  private setVisual(layer: number, visual: ResolvedCutVisual): void {
    const gl = this.gl;
    const uniforms = this.layers[layer]!;
    gl.uniform4f(uniforms.framing, visual.framing.x, visual.framing.y,
      visual.framing.width, visual.framing.height);
    gl.uniform4f(uniforms.transform, visual.transform.x, visual.transform.y,
      visual.transform.scale, visual.transform.rotateDegrees * Math.PI / 180);
    gl.uniform1f(uniforms.opacity, visual.opacity);
  }

  async compose(
    frames: readonly NativeYuvFrame[],
    output: EvaluationPlan['output'],
    metrics: FrameMetricsRecorder,
    plan: EvaluationPlan
  ): Promise<GPUFrameSurface> {
    if (this.disposed) throw new Error('WebGL2 compositor is disposed');
    if (output.colorSpace !== 'bt709-limited') throw new Error(`unsupported color space: ${output.colorSpace}`);
    if (frames.length < 1 || frames.length > 2 || frames.length !== plan.layers.length) {
      throw new Error(`cuts compositor requires one frame, or two during a transition; received ${frames.length}`);
    }
    if (this.canvas.width !== output.width) this.canvas.width = output.width;
    if (this.canvas.height !== output.height) this.canvas.height = output.height;
    const gl = this.gl;
    gl.viewport(0, 0, output.width, output.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.outputSize, output.width, output.height);
    const uploadStarted = performance.now();
    frames.forEach((frame, index) => {
      this.uploadFrame(frame, index);
      this.setVisual(index, plan.layers[index]!.visual);
    });
    if (frames.length === 1 && !this.secondaryInitialized) {
      this.uploadFrame(frames[0]!, 1);
      this.setVisual(1, plan.layers[0]!.visual);
      this.secondaryInitialized = true;
    } else if (frames.length === 2) {
      this.secondaryInitialized = true;
    }
    metrics.record('upload', performance.now() - uploadStarted);
    const transitionCodes: Record<NonNullable<EvaluationPlan['transition']>['type'], number> = {
      'hard-cut': 0,
      dissolve: 1,
      'fade-black': 2,
      'fade-white': 3,
      'reveal-down': 4,
      'reveal-up': 5
    };
    gl.uniform1i(this.transitionType, transitionCodes[plan.transition?.type ?? 'hard-cut'] ?? 0);
    gl.uniform1f(this.transitionProgress, plan.transition?.progress ?? 0);
    const synchronize = this.options.synchronization ?? 'finish';
    const extension = synchronize === 'finish' ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    const query = extension ? gl.createQuery() : null;
    if (extension && query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    const shaderStarted = performance.now();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (extension && query) gl.endQuery(extension.TIME_ELAPSED_EXT);
    if (synchronize === 'finish') gl.finish();
    else gl.flush();
    metrics.record('shader', performance.now() - shaderStarted);
    if (extension && query && !gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      metrics.record('shaderGpu', nanoseconds / 1e6);
      gl.deleteQuery(query);
    } else if (synchronize === 'finish') {
      metrics.record('shaderGpu', performance.now() - shaderStarted);
      if (query) gl.deleteQuery(query);
    }
    return new WebGLSurface(this.canvas, output.width, output.height, gl, metrics);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
