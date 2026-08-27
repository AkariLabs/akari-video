import type {
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  GPUFrameSurface,
  NativeYuvFrame,
  ResolvedCutVisual,
  ResolvedLayerVisual,
  StillImageBitmap,
} from '../types.js';
import { cornersToHomography, invertMat3 } from '../timeline/layer-visual.js';

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 could not allocate a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) ?? 'unknown shader compile failure';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 position; out vec2 uv;
    void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0,1);}`,
  );
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 could not allocate a program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 link failure');
  return program;
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const value = gl.getUniformLocation(program, name);
  if (value === null) throw new Error(`missing WebGL2 uniform: ${name}`);
  return value;
}

function flipRows(
  input: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const stride = width * 4;
  const output = new Uint8Array(input.length);
  for (let row = 0; row < height; row += 1)
    output.set(
      input.subarray(row * stride, (row + 1) * stride),
      (height - row - 1) * stride,
    );
  return output;
}

class WebGLSurface implements GPUFrameSurface {
  private closed = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private readonly gl: WebGL2RenderingContext,
    private readonly metrics: FrameMetricsRecorder,
  ) {}
  async readRgba(): Promise<Uint8Array> {
    if (this.closed) throw new Error('cannot read a closed GPU frame surface');
    const length = this.width * this.height * 4,
      pbo = this.gl.createBuffer();
    if (!pbo) throw new Error('WebGL2 could not allocate a pixel pack buffer');
    const started = performance.now();
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
    this.gl.bufferData(this.gl.PIXEL_PACK_BUFFER, length, this.gl.STREAM_READ);
    this.gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      0,
    );
    const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);
      this.gl.deleteBuffer(pbo);
      throw new Error('WebGL2 could not allocate a readback fence');
    }
    this.gl.flush();
    const wait = performance.now();
    try {
      const deadline = performance.now() + 15000;
      while (true) {
        const status = this.gl.clientWaitSync(fence, 0, 0);
        if (
          status === this.gl.ALREADY_SIGNALED ||
          status === this.gl.CONDITION_SATISFIED
        )
          break;
        if (status === this.gl.WAIT_FAILED || performance.now() >= deadline)
          throw new Error('WebGL2 PBO fence wait failed');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      this.metrics.record('pboWait', performance.now() - wait);
      const raw = new Uint8Array(length);
      this.gl.getBufferSubData(this.gl.PIXEL_PACK_BUFFER, 0, raw);
      const flip = performance.now(),
        rgba = flipRows(raw, this.width, this.height);
      this.metrics.record('rowFlip', performance.now() - flip);
      this.metrics.record('readback', performance.now() - started);
      return rgba;
    } finally {
      this.gl.deleteSync(fence);
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);
      this.gl.deleteBuffer(pbo);
    }
  }
  recordSink(ms: number): void {
    this.metrics.record('sink', ms);
  }
  close(): void {
    this.closed = true;
  }
}

interface CutUniforms {
  framing: WebGLUniformLocation;
  transform: WebGLUniformLocation;
  opacity: WebGLUniformLocation;
  format: WebGLUniformLocation;
  sourceSize: WebGLUniformLocation;
}

interface GpuTimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
export interface WebGL2CompositorOptions {
  synchronization?: 'finish' | 'flush';
}

const YUV_GLSL = `
vec3 yuv709(float y, vec2 chroma) {
  y -= 16.0 / 255.0;
  float u = chroma.r - 0.5;
  float v = chroma.g - 0.5;
  return clamp(vec3(
    1.164383 * y + 1.792741 * v,
    1.164383 * y - 0.213249 * u - 0.532909 * v,
    1.164383 * y + 2.112402 * u
  ), 0.0, 1.0);
}`;
const BASE_FRAGMENT = `#version 300 es
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
${YUV_GLSL}
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
    result = p.y < amount
      ? overBlack(incoming)
      : overBlack(sample0(vec2(p.x, p.y - amount)));
  } else if (transitionType == 5) {
    vec4 incoming = sample1(p);
    result = p.y > 1.0 - amount
      ? overBlack(incoming)
      : overBlack(sample0(vec2(p.x, p.y + amount)));
  } else {
    result = overBlack(outgoing);
  }
  color = vec4(result, 1.0);
}`;

// render-cut evaluates non-normal blend into an RGB plane and then maskedmerge uses the layer's
// opacity-adjusted alpha. The equivalent single-pass expression is
// mix(dst, blendFn(dst, src), srcAlpha * opacity); normal is the same formula with blendFn=src.
const LAYER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 color;
uniform sampler2D backdrop;
uniform sampler2D ly;
uniform sampler2D lu;
uniform sampler2D lv;
uniform sampler2D image;
uniform sampler2D maskY;
uniform int inputKind;
uniform int yuvFormat;
uniform int hasMask;
uniform vec2 outputSize;
uniform mat3 inverseMap;
uniform vec4 cropRect;
uniform float opacity;
uniform int blendMode;
${YUV_GLSL}
vec3 blend(vec3 dst, vec3 src) {
  if (blendMode == 1) return 1.0 - (1.0 - dst) * (1.0 - src);
  if (blendMode == 2) return dst * src;
  if (blendMode == 3) return min(vec3(1.0), dst + src);
  if (blendMode == 4) return abs(dst - src);
  if (blendMode == 5) return min(dst, src);
  if (blendMode == 6) return max(dst, src);
  if (blendMode == 7) return mix(2.0 * dst * src, 1.0 - 2.0 * (1.0 - dst) * (1.0 - src), step(0.5, dst));
  if (blendMode == 8) return mix(2.0 * dst * src, 1.0 - 2.0 * (1.0 - dst) * (1.0 - src), step(0.5, src));
  if (blendMode == 9) {
    vec3 curve = mix(((16.0 * dst - 12.0) * dst + 4.0) * dst, sqrt(dst), step(0.25, dst));
    return mix(
      dst - (1.0 - 2.0 * src) * dst * (1.0 - dst),
      dst + (2.0 * src - 1.0) * (curve - dst),
      step(0.5, src)
    );
  }
  return src;
}
void main() {
  vec4 dst = texture(backdrop, uv);
  vec2 outputPixel = vec2(uv.x, 1.0 - uv.y) * outputSize;
  vec3 homogeneous = inverseMap * vec3(outputPixel, 1.0);
  if (homogeneous.z <= 0.000001) {
    color = dst;
    return;
  }
  vec2 local = homogeneous.xy / homogeneous.z;
  if (any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) {
    color = dst;
    return;
  }
  vec2 sourceUv = cropRect.xy + local * cropRect.zw;
  vec4 src;
  if (inputKind == 1) {
    src = texture(image, sourceUv);
  } else {
    vec2 chroma = yuvFormat == 1
      ? texture(lu, sourceUv).rg
      : vec2(texture(lu, sourceUv).r, texture(lv, sourceUv).r);
    src = vec4(yuv709(texture(ly, sourceUv).r, chroma), 1.0);
  }
  float maskA = hasMask == 1 ? texture(maskY, sourceUv).r : 1.0;
  float alpha = clamp(src.a * maskA * opacity, 0.0, 1.0);
  color = vec4(mix(dst.rgb, blend(dst.rgb, src.rgb), alpha), 1.0);
}`;
const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D source;
void main() { color = texture(source, uv); }`;

const FBO_SCRATCH_UNIT = 9;

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3),
      c = k % 3;
    return (
      a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[c + 3]! + a[r * 3 + 2]! * b[c + 6]!
    );
  });
}

// A layer starts in crop-local normalized coordinates (u,v) in [0,1]^2. Its forward map is
// Translate(output center + x/y) · Rot(rotate) · B(post-crop pixel box) · H(corner pin).
// The fragment shader owns output pixels, so it receives the inverse of that 3x3 and divides by
// homogeneous w to recover crop-local (u,v), then expands that pair into source texture UVs.
function forwardInverse(
  visual: ResolvedLayerVisual,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): Float32Array {
  const h = visual.perspective
    ? cornersToHomography(visual.perspective.corners)
    : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const bw = visual.crop.width * srcW * visual.transform.scale,
    bh = visual.crop.height * srcH * visual.transform.scale;
  const b = [bw, 0, -bw / 2, 0, bh, -bh / 2, 0, 0, 1],
    a = (visual.transform.rotateDegrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const rotate = [c, -s, 0, s, c, 0, 0, 0, 1],
    translate = [
      1,
      0,
      outW / 2 + visual.transform.x,
      0,
      1,
      outH / 2 + visual.transform.y,
      0,
      0,
      1,
    ];
  const inv = invertMat3(multiply(translate, multiply(rotate, multiply(b, h))));
  return new Float32Array([
    inv[0]!,
    inv[3]!,
    inv[6]!,
    inv[1]!,
    inv[4]!,
    inv[7]!,
    inv[2]!,
    inv[5]!,
    inv[8]!,
  ]);
}

/** WebGL2 limited-range BT.709 compositor for cuts, transitions, and an arbitrary layer stack. */
export class WebGL2Compositor implements CompositorBackend {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  readonly stats = { imageUploads: 0, glErrors: 0 };
  private readonly gl: WebGL2RenderingContext;
  private readonly baseProgram: WebGLProgram;
  private readonly layerProgram: WebGLProgram;
  private readonly copyProgram: WebGLProgram;
  private readonly vertices: WebGLBuffer;
  private readonly baseTextures: WebGLTexture[];
  private readonly layerTextures: WebGLTexture[];
  private readonly shapes: Array<string | null> = Array(10).fill(null);
  private readonly cutUniforms: CutUniforms[];
  private readonly baseOutput: WebGLUniformLocation;
  private readonly transitionType: WebGLUniformLocation;
  private readonly transitionProgress: WebGLUniformLocation;
  private readonly fbos: WebGLFramebuffer[];
  private readonly fboTextures: WebGLTexture[];
  private fboShape = '';
  private readonly imageTextures = new WeakMap<
    StillImageBitmap,
    WebGLTexture
  >();
  private readonly ownedImageTextures = new Set<WebGLTexture>();
  private disposed = false;
  private secondary = false;
  constructor(
    canvas = document.createElement('canvas'),
    private readonly options: WebGL2CompositorOptions = {},
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;
    this.baseProgram = createProgram(gl, BASE_FRAGMENT);
    this.layerProgram = createProgram(gl, LAYER_FRAGMENT);
    this.copyProgram = createProgram(gl, COPY_FRAGMENT);
    const vertices = gl.createBuffer();
    if (!vertices) throw new Error('WebGL2 could not allocate a vertex buffer');
    this.vertices = vertices;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    for (const program of [
      this.baseProgram,
      this.layerProgram,
      this.copyProgram,
    ]) {
      gl.useProgram(program);
      const p = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(p);
      gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    }
    const texture = () => {
      const t = gl.createTexture();
      if (!t) throw new Error('WebGL2 could not allocate a texture');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.baseTextures = Array.from({ length: 6 }, texture);
    this.layerTextures = Array.from({ length: 4 }, texture);
    this.fboTextures = [texture(), texture()];
    this.fbos = [0, 1].map((i) => {
      const f = gl.createFramebuffer();
      if (!f) throw new Error('WebGL2 could not allocate framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.fboTextures[i]!,
        0,
      );
      return f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.baseProgram);
    ['y0', 'u0', 'v0', 'y1', 'u1', 'v1'].forEach((n, i) =>
      gl.uniform1i(uniform(gl, this.baseProgram, n), i),
    );
    this.cutUniforms = [0, 1].map((i) => ({
      framing: uniform(gl, this.baseProgram, `framing${i}`),
      transform: uniform(gl, this.baseProgram, `transform${i}`),
      opacity: uniform(gl, this.baseProgram, `opacity${i}`),
      format: uniform(gl, this.baseProgram, `format${i}`),
      sourceSize: uniform(gl, this.baseProgram, `sourceSize${i}`),
    }));
    this.baseOutput = uniform(gl, this.baseProgram, 'outputSize');
    this.transitionType = uniform(gl, this.baseProgram, 'transitionType');
    this.transitionProgress = uniform(
      gl,
      this.baseProgram,
      'transitionProgress',
    );
    gl.useProgram(this.layerProgram);
    [
      ['backdrop', 0],
      ['ly', 1],
      ['lu', 2],
      ['lv', 3],
      ['image', 4],
      ['maskY', 5],
    ].forEach(([n, u]) =>
      gl.uniform1i(uniform(gl, this.layerProgram, n as string), u as number),
    );
    gl.useProgram(this.copyProgram);
    gl.uniform1i(uniform(gl, this.copyProgram, 'source'), 0);
  }
  private bind(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
  }
  private upload(
    texture: WebGLTexture,
    shapeIndex: number,
    data: Uint8Array,
    w: number,
    h: number,
    channels = 1,
  ) {
    this.bind(shapeIndex, texture);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0);
    const format = channels === 2 ? this.gl.RG : this.gl.RED,
      shape = `${w}x${h}x${channels}`;
    if (this.shapes[shapeIndex] === shape)
      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        0,
        0,
        w,
        h,
        format,
        this.gl.UNSIGNED_BYTE,
        data,
      );
    else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        channels === 2 ? this.gl.RG8 : this.gl.R8,
        w,
        h,
        0,
        format,
        this.gl.UNSIGNED_BYTE,
        data,
      );
      this.shapes[shapeIndex] = shape;
    }
  }
  private uploadYuv(
    frame: NativeYuvFrame,
    textures: WebGLTexture[],
    unitBase: number,
    shapeBase: number,
    uniforms?: CutUniforms,
  ) {
    const cw = Math.ceil(frame.width / 2),
      ch = Math.ceil(frame.height / 2);
    this.upload(textures[0]!, shapeBase, frame.y, frame.width, frame.height);
    if (frame.format === 'NV12') {
      this.upload(textures[1]!, shapeBase + 1, frame.uv, cw, ch, 2);
      this.upload(textures[2]!, shapeBase + 2, new Uint8Array([128]), 1, 1);
      if (uniforms) this.gl.uniform1i(uniforms.format, 1);
    } else {
      this.upload(textures[1]!, shapeBase + 1, frame.u, cw, ch);
      this.upload(textures[2]!, shapeBase + 2, frame.v, cw, ch);
      if (uniforms) this.gl.uniform1i(uniforms.format, 0);
    }
    if (uniforms)
      this.gl.uniform2f(uniforms.sourceSize, frame.width, frame.height);
    for (let i = 0; i < 3; i++) this.bind(unitBase + i, textures[i]!);
  }
  private setCut(u: CutUniforms, v: ResolvedCutVisual) {
    this.gl.uniform4f(
      u.framing,
      v.framing.x,
      v.framing.y,
      v.framing.width,
      v.framing.height,
    );
    this.gl.uniform4f(
      u.transform,
      v.transform.x,
      v.transform.y,
      v.transform.scale,
      (v.transform.rotateDegrees * Math.PI) / 180,
    );
    this.gl.uniform1f(u.opacity, v.opacity);
  }
  private ensureFbos(w: number, h: number) {
    const shape = `${w}x${h}`;
    if (shape === this.fboShape) return;
    for (const t of this.fboTextures) {
      // bindTexture uses whichever active unit the preceding upload left behind. Keep FBO
      // attachments on a sampler-free scratch unit so they cannot form a feedback loop with
      // backdrop / layer / mask samplers (units 0..5).
      this.bind(FBO_SCRATCH_UNIT, t);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA8,
        w,
        h,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null,
      );
    }
    this.fboShape = shape;
  }
  private recordGlErrors(synchronization: 'finish' | 'flush'): void {
    if (synchronization !== 'finish') return;
    while (this.gl.getError() !== this.gl.NO_ERROR) this.stats.glErrors += 1;
  }
  private stillTexture(value: StillImageBitmap): WebGLTexture {
    let texture = this.imageTextures.get(value);
    if (texture) return texture;
    texture = this.gl.createTexture()!;
    this.bind(4, texture);
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      value.bitmap,
    );
    this.imageTextures.set(value, texture);
    this.ownedImageTextures.add(texture);
    this.stats.imageUploads += 1;
    return texture;
  }
  private prepareBase(
    frames: readonly NativeYuvFrame[],
    plan: EvaluationPlan,
    output: EvaluationPlan['output'],
  ): number {
    const gl = this.gl;
    gl.useProgram(this.baseProgram);
    gl.uniform2f(this.baseOutput, output.width, output.height);
    const started = performance.now();
    frames.forEach((frame, index) => {
      this.uploadYuv(
        frame,
        this.baseTextures.slice(index * 3, index * 3 + 3),
        index * 3,
        index * 3,
        this.cutUniforms[index],
      );
    });
    if (frames.length === 1 && !this.secondary) {
      this.uploadYuv(
        frames[0]!,
        this.baseTextures.slice(3, 6),
        3,
        3,
        this.cutUniforms[1],
      );
      this.secondary = true;
    } else if (frames.length === 2) {
      this.secondary = true;
    }
    const elapsed = performance.now() - started;
    frames.forEach((_frame, index) =>
      this.setCut(this.cutUniforms[index]!, plan.base[index]!.visual),
    );
    if (frames.length === 1)
      this.setCut(this.cutUniforms[1]!, plan.base[0]!.visual);
    return elapsed;
  }

  private configureBaseDraw(
    plan: EvaluationPlan,
    target: WebGLFramebuffer | null,
  ): void {
    const transitionCodes = {
      'hard-cut': 0,
      dissolve: 1,
      'fade-black': 2,
      'fade-white': 3,
      'reveal-down': 4,
      'reveal-up': 5,
    } as const;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target);
    this.gl.useProgram(this.baseProgram);
    this.gl.uniform1i(
      this.transitionType,
      transitionCodes[plan.transition?.type ?? 'hard-cut'],
    );
    this.gl.uniform1f(this.transitionProgress, plan.transition?.progress ?? 0);
  }

  async compose(
    base: readonly NativeYuvFrame[],
    layers: readonly {
      color: NativeYuvFrame | StillImageBitmap;
      mask?: NativeYuvFrame | null;
    }[],
    output: EvaluationPlan['output'],
    metrics: FrameMetricsRecorder,
    plan: EvaluationPlan,
  ): Promise<GPUFrameSurface> {
    if (this.disposed) throw new Error('WebGL2 compositor is disposed');
    if (output.colorSpace !== 'bt709-limited')
      throw new Error(`unsupported color space: ${output.colorSpace}`);
    if (base.length > 2 || base.length !== plan.base.length) {
      throw new Error(
        `cuts compositor accepts zero to two base frames; received ${base.length}`,
      );
    }
    if (layers.length !== plan.layers.length)
      throw new Error('layer inputs must match plan.layers');
    if (base.length === 0 && layers.length === 0)
      throw new Error('cannot compose an empty plan');
    if (this.canvas.width !== output.width) this.canvas.width = output.width;
    if (this.canvas.height !== output.height)
      this.canvas.height = output.height;

    const gl = this.gl;
    gl.viewport(0, 0, output.width, output.height);
    let uploadElapsedMs =
      base.length > 0 ? this.prepareBase(base, plan, output) : 0;
    let shaderElapsedMs = 0;
    const synchronization = this.options.synchronization ?? 'finish';
    const timer =
      synchronization === 'finish'
        ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
        : null;
    const queries: WebGLQuery[] = [];
    const draw = () => {
      const query = timer ? gl.createQuery() : null;
      if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      const started = performance.now();
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      shaderElapsedMs += performance.now() - started;
      if (timer && query) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        queries.push(query);
      }
    };

    // The no-layers path deliberately keeps the original direct-to-default-framebuffer draw.
    // Avoiding an FBO here structurally preserves the existing 28 golden frames byte-for-byte.
    if (layers.length === 0) {
      this.configureBaseDraw(plan, null);
      draw();
      metrics.record('upload', uploadElapsedMs);
      this.finishFrame(
        metrics,
        shaderElapsedMs,
        synchronization,
        timer,
        queries,
      );
      return new WebGLSurface(
        this.canvas,
        output.width,
        output.height,
        gl,
        metrics,
      );
    }

    this.ensureFbos(output.width, output.height);
    if (base.length > 0) {
      this.configureBaseDraw(plan, this.fbos[0]!);
      draw();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[0]!);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const outLoc = uniform(gl, this.layerProgram, 'outputSize');
    const inverseLoc = uniform(gl, this.layerProgram, 'inverseMap');
    const cropLoc = uniform(gl, this.layerProgram, 'cropRect');
    const opacityLoc = uniform(gl, this.layerProgram, 'opacity');
    const kindLoc = uniform(gl, this.layerProgram, 'inputKind');
    const formatLoc = uniform(gl, this.layerProgram, 'yuvFormat');
    const hasMaskLoc = uniform(gl, this.layerProgram, 'hasMask');
    const blendLoc = uniform(gl, this.layerProgram, 'blendMode');
    const blendModes = [
      'normal',
      'screen',
      'multiply',
      'add',
      'difference',
      'darken',
      'lighten',
      'overlay',
      'hardlight',
      'softlight',
    ];

    // FBO 0 starts as the base. Each layer reads the current backdrop and writes the other FBO;
    // swapping the indices after every draw makes the previous result the next backdrop while
    // keeping texture-unit usage constant regardless of layer count.
    let current = 0;
    for (let index = 0; index < layers.length; index += 1) {
      const input = layers[index]!;
      const color = input.color;
      const layer = plan.layers[index]!;
      const next = 1 - current;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[next]!);
      gl.useProgram(this.layerProgram);
      this.bind(0, this.fboTextures[current]!);
      let width: number;
      let height: number;
      const uploadStarted = performance.now();
      if ('bitmap' in color) {
        width = color.width;
        height = color.height;
        this.bind(4, this.stillTexture(color));
        gl.uniform1i(kindLoc, 1);
      } else {
        width = color.width;
        height = color.height;
        this.uploadYuv(color, this.layerTextures.slice(0, 3), 1, 6);
        gl.uniform1i(kindLoc, 0);
        gl.uniform1i(formatLoc, color.format === 'NV12' ? 1 : 0);
      }
      if (input.mask) {
        this.upload(
          this.layerTextures[3]!,
          9,
          input.mask.y,
          input.mask.width,
          input.mask.height,
        );
        this.bind(5, this.layerTextures[3]!);
        gl.uniform1i(hasMaskLoc, 1);
      } else {
        gl.uniform1i(hasMaskLoc, 0);
      }
      uploadElapsedMs += performance.now() - uploadStarted;
      gl.uniform2f(outLoc, output.width, output.height);
      gl.uniformMatrix3fv(
        inverseLoc,
        false,
        forwardInverse(
          layer.visual,
          width,
          height,
          output.width,
          output.height,
        ),
      );
      gl.uniform4f(
        cropLoc,
        layer.visual.crop.x,
        layer.visual.crop.y,
        layer.visual.crop.width,
        layer.visual.crop.height,
      );
      gl.uniform1f(opacityLoc, layer.opacity);
      gl.uniform1i(blendLoc, Math.max(0, blendModes.indexOf(layer.blend)));
      draw();
      this.recordGlErrors(synchronization);
      current = next;
    }

    // Copy the final ping-pong texture to the visible/default framebuffer without resampling.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.copyProgram);
    this.bind(0, this.fboTextures[current]!);
    draw();
    this.recordGlErrors(synchronization);
    metrics.record('upload', uploadElapsedMs);
    this.finishFrame(metrics, shaderElapsedMs, synchronization, timer, queries);
    return new WebGLSurface(
      this.canvas,
      output.width,
      output.height,
      gl,
      metrics,
    );
  }

  private finishFrame(
    metrics: FrameMetricsRecorder,
    shaderSubmissionMs: number,
    synchronization: 'finish' | 'flush',
    timer: GpuTimerExtension | null,
    queries: readonly WebGLQuery[],
  ): void {
    const syncStarted = performance.now();
    if (synchronization === 'finish') this.gl.finish();
    else this.gl.flush();
    const shaderWallMs = shaderSubmissionMs + performance.now() - syncStarted;
    metrics.record('shader', shaderWallMs);

    let gpuNanoseconds = 0;
    let hasGpuMeasurement =
      timer !== null &&
      queries.length > 0 &&
      !this.gl.getParameter(timer.GPU_DISJOINT_EXT);
    for (const query of queries) {
      if (
        hasGpuMeasurement &&
        this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)
      ) {
        gpuNanoseconds += this.gl.getQueryParameter(
          query,
          this.gl.QUERY_RESULT,
        ) as number;
      } else {
        hasGpuMeasurement = false;
      }
      this.gl.deleteQuery(query);
    }
    if (hasGpuMeasurement) metrics.record('shaderGpu', gpuNanoseconds / 1e6);
    else if (synchronization === 'finish')
      metrics.record('shaderGpu', shaderWallMs);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of [
      ...this.baseTextures,
      ...this.layerTextures,
      ...this.fboTextures,
      ...this.ownedImageTextures,
    ])
      this.gl.deleteTexture(t);
    for (const f of this.fbos) this.gl.deleteFramebuffer(f);
    this.gl.deleteBuffer(this.vertices);
    this.gl.deleteProgram(this.baseProgram);
    this.gl.deleteProgram(this.layerProgram);
    this.gl.deleteProgram(this.copyProgram);
  }
}
