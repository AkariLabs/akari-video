import type {
  CompositorBackend,
  CompositorLayerInput,
  EvaluationPlan,
  FrameMetricsRecorder,
  GPUFrameSurface,
  NativeYuvFrame,
  ResolvedCutVisual,
  ResolvedFilterLayer,
  ResolvedLayerVisual,
  ResolvedTransition,
  StillImageBitmap,
  UploadPath,
} from '../types.js';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import type { ParsedCubeLut } from '../look/cube.js';
import { planFxPasses, fxWorkingSize, fxGaussianGeometry, fxGaussianWeights, FX_PASS_FRAGMENT, FX_PASS_KINDS, type FxCrop, type FxSize, type FxPass } from './fx-passes.js';
import { cornersToHomography, invertMat3 } from '../timeline/layer-visual.js';
import { dissolveNoiseField } from './dissolve-noise.js';

export const TRANSITION_BLUR_MAX_TAPS = 65;

const TRANSITION_CODES = Object.freeze(Object.fromEntries([
  ['hard-cut', 0],
  ...TRANSITION_VOCABULARY.map((entry, index) => [entry.id, index + 1]),
])) as Readonly<Record<'hard-cut' | (typeof TRANSITION_VOCABULARY)[number]['id'], number>>;

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

interface AdjustFxUniforms {
  hasFx: WebGLUniformLocation | null;
  fxSize: WebGLUniformLocation | null;
  fxCrop: WebGLUniformLocation | null;
}

interface CutUniforms extends AdjustFxUniforms {
  framing: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  format: WebGLUniformLocation | null;
  sourceSize: WebGLUniformLocation | null;
  rotation: WebGLUniformLocation | null;
  /** issue #39 layer-style cut: 1 = sample through crop / box instead of framing / fit. */
  layerStyle: WebGLUniformLocation | null;
  crop: WebGLUniformLocation | null;
  box: WebGLUniformLocation | null;
  adjustLut: WebGLUniformLocation | null;
  hasAdjustLut: WebGLUniformLocation | null;
  adjustLutDomainMin: WebGLUniformLocation | null;
  adjustLutDomainMax: WebGLUniformLocation | null;
  adjustLutSize: WebGLUniformLocation | null;
  adjustLutIntensity: WebGLUniformLocation | null;
}

interface AdjustLutUniforms {
  hasAdjustLut: WebGLUniformLocation | null;
  adjustLutDomainMin: WebGLUniformLocation | null;
  adjustLutDomainMax: WebGLUniformLocation | null;
  adjustLutSize: WebGLUniformLocation | null;
  adjustLutIntensity: WebGLUniformLocation | null;
}

interface BaseProgramState {
  program: WebGLProgram;
  cutUniforms: readonly CutUniforms[];
  output: WebGLUniformLocation;
  progress: WebGLUniformLocation | null;
  dissolveNoise: WebGLUniformLocation | null;
  secondary: boolean;
}

interface GpuTimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
export interface WebGL2CompositorOptions {
  synchronization?: 'finish' | 'flush';
  uploadPath?: UploadPath;
  /** Diagnostic only. Consecutive stage boundaries; null ends the last stage.
   * The caller owns queries and must not wrap compose in another elapsed query.
   * Omitted in production: no callbacks or diagnostic queries are executed.
   */
  passTimer?: (stage: string | null) => void;
}

export class DirectUploadFallbackError extends Error {
  constructor(readonly reason: string) {
    super(`direct VideoFrame upload failed: ${reason}`);
    this.name = 'DirectUploadFallbackError';
  }
}

const DIRECT_UPLOADABLE_VIDEO_FORMATS = new Set<string | null>([
  null,
  'NV12',
  'I420',
  'RGBA',
  'BGRA',
  'RGBX',
  'BGRX',
]);

const PACKED_RGB_VIDEO_FORMATS = new Set<string>([
  'RGBA',
  'BGRA',
  'RGBX',
  'BGRX',
]);

export function isDirectUploadableFormat(format: string | null): boolean {
  return DIRECT_UPLOADABLE_VIDEO_FORMATS.has(format);
}

function isPackedRgbVideoFormat(format: string | null): boolean {
  return format !== null && PACKED_RGB_VIDEO_FORMATS.has(format);
}

function isCopyToPassthroughVideoFormat(format: string | null): boolean {
  return format === null || isPackedRgbVideoFormat(format);
}

const YUV_GLSL = `
vec3 yuv709Unclamped(float y, vec2 chroma) {
  y -= 16.0 / 255.0;
  float u = chroma.r - 0.5;
  float v = chroma.g - 0.5;
  return vec3(
    1.164383 * y + 1.792741 * v,
    1.164383 * y - 0.213249 * u - 0.532909 * v,
    1.164383 * y + 2.112402 * u
  );
}
vec3 yuv709(float y, vec2 chroma) {
  return clamp(yuv709Unclamped(y, chroma), 0.0, 1.0);
}`;

interface FxSource {
  size: FxSize;
  crop: FxCrop;
  displayed: FxSize;
  format: number;
  rotation: number;
  rgbaUnit: number;
  yuvUnits: readonly number[];
  preserveAlpha: boolean;
  lut: ParsedCubeLut | undefined;
  lutUnit: number;
}
interface FxResult { texture: WebGLTexture; size: FxSize; crop: FxCrop }
interface FxProgram {
  program: WebGLProgram;
  locations: Record<string, WebGLUniformLocation | null>;
}

function fxResultGlsl(suffix: string, sampler: string): string {
  return `
uniform int hasFx${suffix};
uniform vec2 fxSize${suffix};
uniform vec4 fxCrop${suffix};
vec4 sampleFx${suffix}(vec2 local) {
  vec2 pixel = clamp(local * fxSize${suffix}, vec2(0.5), fxSize${suffix} - 0.5);
  return texture(${sampler}, pixel / vec2(textureSize(${sampler}, 0)));
}`;
}

// Convert output pixels to work texels using the projected crop axes at its centre.
// For perspective this is a single source-space kernel, shared across the crop.
function fxDisplayedSize(inverse: Float32Array): FxSize {
  const forward = invertMat3([
    inverse[0]!, inverse[3]!, inverse[6]!, inverse[1]!, inverse[4]!, inverse[7]!,
    inverse[2]!, inverse[5]!, inverse[8]!,
  ]);
  const point = (x: number, y: number) => {
    const z = forward[6]! * x + forward[7]! * y + forward[8]!;
    return [(forward[0]! * x + forward[1]! * y + forward[2]!) / z,
      (forward[3]! * x + forward[4]! * y + forward[5]!) / z];
  };
  const left = point(0, 0.5), right = point(1, 0.5), top = point(0.5, 0), bottom = point(0.5, 1);
  return { width: Math.hypot(right[0]! - left[0]!, right[1]! - left[1]!),
    height: Math.hypot(bottom[0]! - top[0]!, bottom[1]! - top[1]!) };
}

const FX_PREP_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D sourceY;
uniform sampler2D sourceU;
uniform sampler2D sourceV;
uniform sampler2D sourceRgba;
uniform int sourceFormat;
uniform int sourceRotation;
uniform int preserveAlpha;
uniform vec2 sourceSize;
uniform vec4 cropRect;
uniform sampler3D adjustLut;
uniform int hasAdjustLut;
uniform vec3 adjustLutDomainMin;
uniform vec3 adjustLutDomainMax;
uniform float adjustLutSize;
uniform float adjustLutIntensity;
${YUV_GLSL}
vec3 applyAdjust(vec3 rgb) {
  if (hasAdjustLut == 0) return rgb;
  vec3 unit = clamp((rgb - adjustLutDomainMin) / (adjustLutDomainMax - adjustLutDomainMin), 0.0, 1.0);
  vec3 coord = (unit * (adjustLutSize - 1.0) + 0.5) / adjustLutSize;
  return mix(rgb, texture(adjustLut, coord).rgb, adjustLutIntensity);
}
void main() {
  vec2 inset = min(0.5 / sourceSize, cropRect.zw * 0.5);
  vec2 q = clamp(cropRect.xy + uv * cropRect.zw, cropRect.xy + inset, cropRect.xy + cropRect.zw - inset);
  if (sourceRotation == 1) q = vec2(1.0 - q.y, q.x);
  else if (sourceRotation == 2) q = vec2(1.0 - q.x, 1.0 - q.y);
  else if (sourceRotation == 3) q = vec2(q.y, 1.0 - q.x);
  vec4 src;
  if (sourceFormat == 2) {
    src = texture(sourceRgba, q);
    if (preserveAlpha == 0) src.a = 1.0;
  } else {
    vec2 chroma = sourceFormat == 1 ? texture(sourceU, q).rg
      : vec2(texture(sourceU, q).r, texture(sourceV, q).r);
    src = vec4(yuv709(texture(sourceY, q).r, chroma), 1.0);
  }
  color = vec4(applyAdjust(src.rgb), src.a);
}`;

const baseFragmentPrefix = (type: ResolvedTransition['type']) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D y0;
uniform sampler2D u0;
uniform sampler2D v0;
uniform sampler2D y1;
uniform sampler2D u1;
uniform sampler2D v1;
uniform sampler2D rgba0;
uniform sampler2D rgba1;
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
uniform int rotation0;
uniform int rotation1;
uniform int layerStyle0;
uniform int layerStyle1;
uniform vec4 crop0;
uniform vec4 crop1;
uniform vec2 box0;
uniform vec2 box1;
uniform sampler3D adjustLut0;
uniform sampler3D adjustLut1;
uniform int hasAdjustLut0;
uniform int hasAdjustLut1;
uniform vec3 adjustLutDomainMin0;
uniform vec3 adjustLutDomainMin1;
uniform vec3 adjustLutDomainMax0;
uniform vec3 adjustLutDomainMax1;
uniform float adjustLutSize0;
uniform float adjustLutSize1;
uniform float adjustLutIntensity0;
uniform float adjustLutIntensity1;
uniform float transitionProgress;
${type === 'dissolve' ? 'uniform sampler2D dissolveNoise;' : ''}
${YUV_GLSL}
vec2 inverseVisual(vec2 p, vec4 transform, vec4 framing) {
  vec2 pixel = (p - 0.5) * outputSize - transform.xy;
  float angle = transform.w;
  pixel = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * pixel;
  pixel /= transform.z;
  vec2 local = pixel / outputSize + 0.5;
  return framing.xy + local * framing.zw;
}
// issue #39 layer-style cut: the inverse of the layer program's Translate(center + x/y) · Rot · B(box)
// (forwardInverse without the corner pin), returning crop-local (u, v); box is crop × source × scale in px.
vec2 inverseBox(vec2 p, vec4 transform, vec2 box) {
  vec2 pixel = (p - 0.5) * outputSize - transform.xy;
  float angle = transform.w;
  pixel = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * pixel;
  return pixel / box + 0.5;
}
vec2 canvasToSource(vec2 canvasPoint, vec2 sourceSize) {
  float fit = min(outputSize.x / sourceSize.x, outputSize.y / sourceSize.y);
  vec2 fitted = sourceSize * fit;
  vec2 offset = (outputSize - fitted) * 0.5;
  return (canvasPoint * outputSize - offset) / fitted;
}
vec2 unrotate(vec2 q, int rotation) {
  if (rotation == 0) return q;
  if (rotation == 1) return vec2(1.0 - q.y, q.x);
  if (rotation == 2) return vec2(1.0 - q.x, 1.0 - q.y);
  return vec2(q.y, 1.0 - q.x);
}
vec3 applyAdjust0(vec3 rgb) {
  if (hasAdjustLut0 == 0) return rgb;
  vec3 unit = clamp((rgb - adjustLutDomainMin0) / (adjustLutDomainMax0 - adjustLutDomainMin0), 0.0, 1.0);
  vec3 coord = (unit * (adjustLutSize0 - 1.0) + 0.5) / adjustLutSize0;
  return mix(rgb, texture(adjustLut0, coord).rgb, adjustLutIntensity0);
}
vec3 applyAdjust1(vec3 rgb) {
  if (hasAdjustLut1 == 0) return rgb;
  vec3 unit = clamp((rgb - adjustLutDomainMin1) / (adjustLutDomainMax1 - adjustLutDomainMin1), 0.0, 1.0);
  vec3 coord = (unit * (adjustLutSize1 - 1.0) + 0.5) / adjustLutSize1;
  return mix(rgb, texture(adjustLut1, coord).rgb, adjustLutIntensity1);
}
${fxResultGlsl("0", "rgba0")}
${fxResultGlsl("1", "rgba1")}
vec4 sample0(vec2 p) {
  vec2 q;
  if (layerStyle0 == 1) {
    vec2 local = inverseBox(p, transform0, box0);
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
    q = crop0.xy + local * crop0.zw;
  } else {
    vec2 canvasPoint = inverseVisual(p, transform0, framing0);
    if (canvasPoint.x < framing0.x || canvasPoint.x > framing0.x + framing0.z || canvasPoint.y < framing0.y || canvasPoint.y > framing0.y + framing0.w) return vec4(0.0);
    q = canvasToSource(canvasPoint, sourceSize0);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  }
  if (hasFx0 == 1) return vec4(sampleFx0((q - fxCrop0.xy) / fxCrop0.zw).rgb, opacity0);
  q = unrotate(q, rotation0);
  if (format0 == 2) {
    vec3 rgb = applyAdjust0(texture(rgba0, q).rgb);
    return vec4(rgb, opacity0);
  }
  vec2 chroma = format0 == 1 ? texture(u0, q).rg : vec2(texture(u0, q).r, texture(v0, q).r);
  vec3 rgb = applyAdjust0(yuv709(texture(y0, q).r, chroma));
  return vec4(rgb, opacity0);
}
vec4 sample1(vec2 p) {
  vec2 q;
  if (layerStyle1 == 1) {
    vec2 local = inverseBox(p, transform1, box1);
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
    q = crop1.xy + local * crop1.zw;
  } else {
    vec2 canvasPoint = inverseVisual(p, transform1, framing1);
    if (canvasPoint.x < framing1.x || canvasPoint.x > framing1.x + framing1.z || canvasPoint.y < framing1.y || canvasPoint.y > framing1.y + framing1.w) return vec4(0.0);
    q = canvasToSource(canvasPoint, sourceSize1);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  }
  if (hasFx1 == 1) return vec4(sampleFx1((q - fxCrop1.xy) / fxCrop1.zw).rgb, opacity1);
  q = unrotate(q, rotation1);
  if (format1 == 2) {
    vec3 rgb = applyAdjust1(texture(rgba1, q).rgb);
    return vec4(rgb, opacity1);
  }
  vec2 chroma = format1 == 1 ? texture(u1, q).rg : vec2(texture(u1, q).r, texture(v1, q).r);
  vec3 rgb = applyAdjust1(yuv709(texture(y1, q).r, chroma));
  return vec4(rgb, opacity1);
}
vec3 overBlack(vec4 value) { return value.rgb * value.a; }
vec3 A(vec2 p) { return overBlack(sample0(p)); }
vec3 B(vec2 p) { return overBlack(sample1(p)); }
vec2 texelOf(vec2 pixelIndex) { return (pixelIndex + 0.5) / outputSize; }
float wrapPixel(float value, float size) {
  float wrapped = mod(value, size);
  return wrapped < 0.0 ? wrapped + size : wrapped;
}
vec3 mixFf(vec3 a, vec3 b, float P) { return a * P + b * (1.0 - P); }
`;

function movingTransitionBody(type: ResolvedTransition['type']): string | null {
  const settings: Partial<Record<ResolvedTransition['type'], {
    axis: 'x' | 'y';
    negative: boolean;
    mode: 'slide' | 'cover' | 'reveal';
  }>> = {
    'slide-left': { axis: 'x', negative: true, mode: 'slide' },
    'slide-right': { axis: 'x', negative: false, mode: 'slide' },
    'slide-up': { axis: 'y', negative: true, mode: 'slide' },
    'slide-down': { axis: 'y', negative: false, mode: 'slide' },
    'cover-left': { axis: 'x', negative: true, mode: 'cover' },
    'cover-right': { axis: 'x', negative: false, mode: 'cover' },
    'cover-up': { axis: 'y', negative: true, mode: 'cover' },
    'cover-down': { axis: 'y', negative: false, mode: 'cover' },
    'reveal-left': { axis: 'x', negative: true, mode: 'reveal' },
    'reveal-right': { axis: 'x', negative: false, mode: 'reveal' },
    'reveal-up': { axis: 'y', negative: true, mode: 'reveal' },
    'reveal-down': { axis: 'y', negative: false, mode: 'reveal' },
  };
  const value = settings[type];
  if (!value) return null;
  const horizontal = value.axis === 'x';
  const extent = horizontal ? 'outputSize.x' : 'outputSize.y';
  const index = horizontal ? 'ip.x' : 'ip.y';
  const moved = horizontal
    ? 'texelOf(vec2(wrapped, ip.y))'
    : 'texelOf(vec2(ip.x, wrapped))';
  const result = value.mode === 'slide'
    ? 'inside ? B(moved) : A(moved)'
    : value.mode === 'cover'
      ? 'inside ? B(moved) : A(p)'
      : 'inside ? B(p) : A(moved)';
  return `
    float extent = ${extent};
    float shifted = trunc(${value.negative ? '-' : ''}P * extent) + ${index};
    float wrapped = wrapPixel(shifted, extent);
    bool inside = shifted >= 0.0 && shifted < extent;
    vec2 moved = ${moved};
    result = ${result};`;
}

function transitionFragmentBody(type: ResolvedTransition['type']): string {
  const moving = movingTransitionBody(type);
  if (moving) return moving;
  switch (type) {
    case 'hard-cut':
      return 'result = A(p);';
    case 'dissolve':
      return 'result = texelFetch(dissolveNoise, ivec2(ip), 0).r < amount ? B(p) : A(p);';
    case 'fade':
      return 'result = mixFf(A(p), B(p), P);';
    case 'fade-black':
    case 'fade-white':
      return `
    const float phase = 0.2;
    // The plate maps Y=0/255 with neutral U/V=128 directly to unclamped RGB.
    vec3 plate = yuv709Unclamped(${type === 'fade-white' ? '1.0' : '0.0'}, vec2(128.0 / 255.0));
    vec3 a = A(p), b = B(p);
    result = clamp(mixFf(
      mixFf(a, plate, smoothstep(1.0 - phase, 1.0, P)),
      mixFf(plate, b, smoothstep(phase, 1.0, P)), P), 0.0, 1.0);`;
    case 'fade-grays':
      return `
    const float phase = 0.2;
    vec3 a = A(p), b = B(p);
    vec3 ga = vec3(dot(a, vec3(0.2126, 0.7152, 0.0722)));
    vec3 gb = vec3(dot(b, vec3(0.2126, 0.7152, 0.0722)));
    result = mixFf(
      mixFf(a, ga, smoothstep(1.0 - phase, 1.0, P)),
      mixFf(gb, b, smoothstep(phase, 1.0, P)), P);`;
    case 'wipe-left':
      return `
    float z = trunc(P * outputSize.x);
    result = ip.x > z ? B(p) : A(p);`;
    case 'wipe-right':
      return `
    float z = trunc((1.0 - P) * outputSize.x);
    result = ip.x > z ? A(p) : B(p);`;
    case 'wipe-up':
      return `
    float z = trunc(P * outputSize.y);
    result = ip.y > z ? B(p) : A(p);`;
    case 'wipe-down':
      return `
    float z = trunc((1.0 - P) * outputSize.y);
    result = ip.y > z ? A(p) : B(p);`;
    case 'radial':
      return `
    float s = smoothstep(0.0, 1.0,
      atan(ip.x - outputSize.x * 0.5, ip.y - outputSize.y * 0.5)
      - (P - 0.5) * (3.141592653589793 * 2.5));
    result = B(p) * s + A(p) * (1.0 - s);`;
    case 'circle-open':
    case 'circle-close': {
      const open = type === 'circle-open';
      return `
    float radius = length(outputSize * 0.5);
    float pp = ${open ? '(P - 0.5)' : '(1.0 - P - 0.5)'} * 3.0;
    float s = smoothstep(0.0, 1.0, length(ip - outputSize * 0.5) / radius + pp);
    result = ${open ? 'A(p) * s + B(p) * (1.0 - s)' : 'B(p) * s + A(p) * (1.0 - s)'};`;
    }
    case 'zoom-in':
      return `
    float zf = smoothstep(0.5, 1.0, P);
    vec2 unit = vec2(
      0.5 + (ip.x / outputSize.x - 0.5) * zf,
      0.5 + (ip.y / outputSize.y - 0.5) * zf);
    vec2 sourcePixel = ceil(unit * (outputSize - 1.0));
    float s = smoothstep(0.0, 0.5, P);
    result = A(texelOf(sourcePixel)) * s + B(p) * (1.0 - s);`;
    case 'squeeze-h':
      return `
    float zr = 0.5 + (ip.y / outputSize.y - 0.5) / max(P, 0.000001);
    result = (P <= 0.0 || zr < 0.0 || zr > 1.0)
      ? B(p) : A(texelOf(vec2(ip.x, floor(zr * (outputSize.y - 1.0) + 0.5))));`;
    case 'squeeze-v':
      return `
    float zc = 0.5 + (ip.x / outputSize.x - 0.5) / max(P, 0.000001);
    result = (P <= 0.0 || zc < 0.0 || zc > 1.0)
      ? B(p) : A(texelOf(vec2(floor(zc * (outputSize.x - 1.0) + 0.5), ip.y)));`;
    case 'blur':
      return `
    float prog = P <= 0.5 ? P * 2.0 : (1.0 - P) * 2.0;
    int size = 1 + int(trunc((outputSize.x * 0.5) * prog));
    // xfade uses the complete causal box. The fixed tap cap keeps this one-pass GPU path bounded.
    result = horizontalBlur(false, ip, size) * P + horizontalBlur(true, ip, size) * (1.0 - P);`;
    case 'pixelize':
      return `
    float d = min(P, 1.0 - P);
    float dist = ceil(d * 50.0) / 50.0;
    float sq = 2.0 * dist * min(outputSize.x, outputSize.y) / 20.0;
    float sx = dist > 0.0
      ? min(trunc(floor(ip.x / sq) * sq + 0.5 * sq), outputSize.x - 1.0) : ip.x;
    float sy = dist > 0.0
      ? min(trunc(floor(ip.y / sq) * sq + 0.5 * sq), outputSize.y - 1.0) : ip.y;
    vec2 q = texelOf(vec2(sx, sy));
    result = A(q) * P + B(q) * (1.0 - P);`;
    default:
      throw new Error(`unsupported transition type: ${String(type)}`);
  }
}

export function buildBaseFragment(type: ResolvedTransition['type']): string {
  if (!Object.prototype.hasOwnProperty.call(TRANSITION_CODES, type))
    throw new Error(`unsupported transition type: ${String(type)}`);
  const blurHelper = type === 'blur'
    ? `vec3 horizontalBlur(bool incoming, vec2 ip, int size) {
  int taps = min(size, ${TRANSITION_BLUR_MAX_TAPS});
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${TRANSITION_BLUR_MAX_TAPS}; i++) {
    if (i >= taps) break;
    float sx = min(outputSize.x - 1.0,
      ip.x + floor(float(i) * float(size) / float(taps)));
    vec2 q = texelOf(vec2(sx, ip.y));
    sum += incoming ? B(q) : A(q);
  }
  return sum / float(taps);
}
`
    : '';
  return `${baseFragmentPrefix(type)}${blurHelper}void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  vec2 ip = floor(p * outputSize);
  float amount = clamp(transitionProgress, 0.0, 1.0);
  float P = 1.0 - amount;
  vec3 result;
  ${transitionFragmentBody(type)}
  color = vec4(result, 1.0);
}`;
}

// render-cut evaluates non-normal blend into an RGB plane and then maskedmerge uses the layer's
// opacity-adjusted alpha. The equivalent single-pass expression is
// mix(dst, blendFn(dst, src), srcAlpha * opacity); normal is the same formula with blendFn=src.
const LAYER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D backdrop;
uniform sampler2D ly;
uniform sampler2D lu;
uniform sampler2D lv;
uniform sampler2D image;
uniform sampler2D maskY;
uniform sampler2D lrgba;
uniform sampler2D maskRgba;
uniform int inputKind;
uniform int yuvFormat;
uniform int hasMask;
uniform int maskFormat;
uniform int layerRotation;
uniform int maskRotation;
uniform vec2 outputSize;
uniform mat3 inverseMap;
uniform vec4 cropRect;
uniform float opacity;
uniform int blendMode;
uniform sampler3D adjustLut;
uniform int hasAdjustLut;
uniform vec3 adjustLutDomainMin;
uniform vec3 adjustLutDomainMax;
uniform float adjustLutSize;
uniform float adjustLutIntensity;
${YUV_GLSL}
vec2 unrotate(vec2 q, int rotation) {
  if (rotation == 0) return q;
  if (rotation == 1) return vec2(1.0 - q.y, q.x);
  if (rotation == 2) return vec2(1.0 - q.x, 1.0 - q.y);
  return vec2(q.y, 1.0 - q.x);
}
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
vec3 applyAdjust(vec3 rgb) {
  if (hasAdjustLut == 0) return rgb;
  vec3 unit = clamp((rgb - adjustLutDomainMin) / (adjustLutDomainMax - adjustLutDomainMin), 0.0, 1.0);
  vec3 coord = (unit * (adjustLutSize - 1.0) + 0.5) / adjustLutSize;
  return mix(rgb, texture(adjustLut, coord).rgb, adjustLutIntensity);
}
uniform sampler2D fxTexture;
${fxResultGlsl("", "fxTexture")}
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
  vec2 colorUv = unrotate(sourceUv, layerRotation);
  vec2 matteUv = unrotate(sourceUv, maskRotation);
  vec4 src;
  if (hasFx == 1) {
    src = sampleFx(local);
  } else {
    if (inputKind == 1) {
      src = texture(image, colorUv);
    } else if (yuvFormat == 2) {
      src = vec4(texture(lrgba, colorUv).rgb, 1.0);
    } else {
      vec2 chroma = yuvFormat == 1
        ? texture(lu, colorUv).rg
        : vec2(texture(lu, colorUv).r, texture(lv, colorUv).r);
      src = vec4(yuv709(texture(ly, colorUv).r, chroma), 1.0);
    }
    src.rgb = applyAdjust(src.rgb);
  }
  float maskA = hasMask == 1
    ? (maskFormat == 2 ? texture(maskRgba, matteUv).r : texture(maskY, matteUv).r)
    : 1.0;
  float alpha = clamp(src.a * maskA * opacity, 0.0, 1.0);
  color = vec4(mix(dst.rgb, blend(dst.rgb, src.rgb), alpha), 1.0);
}`;
const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D source;
void main() { color = texture(source, uv); }`;
const LOOK_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D source;
uniform sampler3D lut;
uniform vec3 lutDomainMin;
uniform vec3 lutDomainMax;
uniform float lutSize;
uniform float lutIntensity;
void main() {
  vec4 src = texture(source, uv);
  vec3 unit = clamp((src.rgb - lutDomainMin) / (lutDomainMax - lutDomainMin), 0.0, 1.0);
  vec3 coord = (unit * (lutSize - 1.0) + 0.5) / lutSize;
  vec3 lutted = texture(lut, coord).rgb;
  color = vec4(mix(src.rgb, lutted, lutIntensity), src.a);
}`;
const FILTER_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D backdrop;
uniform sampler3D lut;
uniform int filterType;
uniform float value;
uniform float lutIntensity;
uniform vec3 lutDomainMin;
uniform vec3 lutDomainMax;
uniform float lutSize;
uniform vec2 corners[4];
uniform float opacity;
uniform float edgePx;
uniform vec2 outputSize;
vec3 saturation709(vec3 rgb, float amount) {
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float cb = (rgb.b - y) / 1.8556;
  float cr = (rgb.r - y) / 1.5748;
  cb *= amount;
  cr *= amount;
  return clamp(vec3(
    y + 1.5748 * cr,
    y - 0.187324 * cb - 0.468124 * cr,
    y + 1.8556 * cb
  ), 0.0, 1.0);
}
float edgeDistance(vec2 a, vec2 b, vec2 p) {
  vec2 edge = b - a;
  return (edge.x * (p.y - a.y) - edge.y * (p.x - a.x)) / max(length(edge), 0.000001);
}
void main() {
  vec4 src = texture(backdrop, uv);
  vec3 graded;
  if (filterType == 0) {
    graded = 1.0 - src.rgb;
  } else if (filterType == 1) {
    graded = saturation709(src.rgb, value);
  } else {
    vec3 unit = clamp((src.rgb - lutDomainMin) / (lutDomainMax - lutDomainMin), 0.0, 1.0);
    vec3 coord = (unit * (lutSize - 1.0) + 0.5) / lutSize;
    graded = mix(src.rgb, texture(lut, coord).rgb, lutIntensity);
  }
  vec2 p = vec2(uv.x, 1.0 - uv.y) * outputSize;
  float distancePx = min(
    min(edgeDistance(corners[0], corners[1], p), edgeDistance(corners[1], corners[3], p)),
    min(edgeDistance(corners[3], corners[2], p), edgeDistance(corners[2], corners[0], p))
  );
  float mask = smoothstep(-edgePx * 0.5, edgePx * 0.5, distancePx);
  color = vec4(mix(src.rgb, graded, mask * opacity), src.a);
}`;

const FBO_SCRATCH_UNIT = 9;
const BASE_RGBA_UNITS = [6, 7] as const;
const LAYER_RGBA_UNIT = 8;
const MASK_RGBA_UNIT = 10;
const LUT_UNIT = 11;
const DISSOLVE_NOISE_UNIT = 12;
const BASE_ADJUST_LUT_UNITS = [LUT_UNIT, 13] as const;
const FX_ORIGINAL_UNIT = 14;
const REQUIRED_TEXTURE_UNITS = FX_ORIGINAL_UNIT + 1;

function adjustFxFrameIndex(plan: EvaluationPlan): number {
  // Animated grain requires a supplied output frame index; absent metadata keeps seed 0.
  // Never use draw count: seeks and retries must agree.
  return Number.isSafeInteger(plan.frameIndex) ? Math.max(0, plan.frameIndex!) >>> 0 : 0;
}

function isVideoFrame(value: NativeYuvFrame | StillImageBitmap | VideoFrame): value is VideoFrame {
  return 'displayWidth' in value && 'displayHeight' in value && 'close' in value;
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3),
      c = k % 3;
    return (
      a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[c + 3]! + a[r * 3 + 2]! * b[c + 6]!
    );
  });
}

const HALF_FLOAT_BUFFER = new ArrayBuffer(4);
const HALF_FLOAT_BITS = new Uint32Array(HALF_FLOAT_BUFFER);
const HALF_FLOAT_VALUE = new Float32Array(HALF_FLOAT_BUFFER);

function floatToHalf(value: number): number {
  HALF_FLOAT_VALUE[0] = value;
  const word = HALF_FLOAT_BITS[0]!;
  const sign = (word >>> 16) & 0x8000;
  const exponent = ((word >>> 23) & 0xff) - 127 + 15;
  const mantissa = word & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    return sign | ((mantissa | 0x800000) >>> (14 - exponent));
  }
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function packLutRgba16f(lut: ParsedCubeLut): Uint16Array {
  const output = new Uint16Array(lut.size ** 3 * 4);
  for (let source = 0, target = 0; source < lut.data.length; source += 3, target += 4) {
    output[target] = floatToHalf(lut.data[source]!);
    output[target + 1] = floatToHalf(lut.data[source + 1]!);
    output[target + 2] = floatToHalf(lut.data[source + 2]!);
    output[target + 3] = floatToHalf(1);
  }
  return output;
}

// A layer starts in crop-local normalized coordinates (u,v) in [0,1]^2. Its forward map is
// Translate(output center + x/y) · Rot(rotate) · B(post-crop pixel box) · H(corner pin).
// The fragment shader owns output pixels, so it receives the inverse of that 3x3 and divides by
// homogeneous w to recover crop-local (u,v), then expands that pair into source texture UVs.
// Exported so the compositor contract test can compare the base path's layer-style mapping against it.
export function forwardInverse(
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

const FULL_CROP = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/**
 * issue #39: pixel box of a layer-style cut — the same expression the layer program's forwardInverse
 * uses (crop × source logical size × transform.scale). srcW / srcH are the display-rotated sizes.
 */
export function cutLayerStyleBox(
  visual: ResolvedCutVisual,
  srcW: number,
  srcH: number,
): { width: number; height: number } {
  const crop = visual.layerStyle?.crop ?? FULL_CROP;
  return {
    width: crop.width * srcW * visual.transform.scale,
    height: crop.height * srcH * visual.transform.scale,
  };
}

/**
 * JS mirror of the base shader's layer-style sampling (`inverseBox` followed by the crop expansion):
 * output pixel (px, py) → normalized source UV, or null outside the box. The compositor contract test
 * evaluates this against forwardInverse on identical inputs; keep the arithmetic in the same order.
 */
export function cutLayerStyleSourceUv(
  visual: ResolvedCutVisual,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  px: number,
  py: number,
): readonly [number, number] | null {
  const crop = visual.layerStyle?.crop ?? FULL_CROP;
  const box = cutLayerStyleBox(visual, srcW, srcH);
  const dx = px - outW / 2 - visual.transform.x;
  const dy = py - outH / 2 - visual.transform.y;
  const angle = (visual.transform.rotateDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const u = (c * dx + s * dy) / box.width + 0.5;
  const v = (-s * dx + c * dy) / box.height + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [crop.x + u * crop.width, crop.y + v * crop.height];
}

function rotationQuarterTurns(frame: NativeYuvFrame | VideoFrame): number {
  const value = Number((frame as { rotationDeg?: number }).rotationDeg ?? 0);
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value / 90) % 4) + 4) % 4;
}

function logicalSize(width: number, height: number, rotation: number): { width: number; height: number } {
  return rotation === 1 || rotation === 3
    ? { width: height, height: width }
    : { width, height };
}

/** WebGL2 limited-range BT.709 compositor for cuts, transitions, and an arbitrary layer stack. */
export class WebGL2Compositor implements CompositorBackend {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  readonly stats: {
    imageUploads: number;
    glErrors: number;
    directUploadFallbackReason: string | null;
    directUploadFrameDimensions: {
      codedWidth: number;
      codedHeight: number;
      displayWidth: number;
      displayHeight: number;
      visibleRect: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
    } | null;
    colorspaceConversion: 'browser-default';
  } = {
    imageUploads: 0,
    glErrors: 0,
    directUploadFallbackReason: null,
    directUploadFrameDimensions: null,
    colorspaceConversion: 'browser-default',
  };
  private readonly gl: WebGL2RenderingContext;
  private readonly basePrograms = new Map<ResolvedTransition['type'], BaseProgramState>();
  private readonly layerProgram: WebGLProgram;
  private readonly filterProgram: WebGLProgram;
  private readonly copyProgram: WebGLProgram;
  private readonly lookProgram: WebGLProgram;
  private readonly vertices: WebGLBuffer;
  private readonly baseTextures: WebGLTexture[];
  private readonly baseRgbaTextures: WebGLTexture[];
  private readonly layerTextures: WebGLTexture[];
  private readonly layerRgbaTextures: WebGLTexture[];
  private readonly shapes: Array<string | null> = Array(11).fill(null);
  private readonly fbos: WebGLFramebuffer[];
  private readonly fboTextures: WebGLTexture[];
  private fboShape = '';
  private fxPrepProgram: FxProgram | null = null;
  private readonly fxPassPrograms = new Map<number, FxProgram>();
  private readonly fxFbos: WebGLFramebuffer[] = [];
  private readonly fxTextures: WebGLTexture[] = [];
  private fxOriginalTexture: WebGLTexture | null = null;
  private fxAllocation: FxSize = { width: 0, height: 0 };
  private readonly fxWeightCache = new Map<number, ReturnType<typeof fxGaussianWeights>>();
  // A/B must coexist for a transition. These are snapshots, never extra pass FBOs.
  private readonly baseFxTextures: Array<{ texture: WebGLTexture; allocation: FxSize }> = [];
  private readonly imageTextures = new WeakMap<
    StillImageBitmap,
    WebGLTexture
  >();
  private readonly ownedImageTextures = new Set<WebGLTexture>();
  private readonly lookTextures = new WeakMap<ParsedCubeLut, WebGLTexture>();
  private readonly ownedLookTextures = new Set<WebGLTexture>();
  private readonly dissolveNoiseTextures = new Map<string, WebGLTexture>();
  private disposed = false;
  private directUploadDisabled = false;
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
    this.directUploadDisabled = options.uploadPath === 'copyTo';
    if (!this.directUploadDisabled &&
      Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) < REQUIRED_TEXTURE_UNITS) {
      this.directUploadDisabled = true;
      this.stats.directUploadFallbackReason =
        `requires ${REQUIRED_TEXTURE_UNITS} texture units`;
    }
    this.layerProgram = createProgram(gl, LAYER_FRAGMENT);
    this.filterProgram = createProgram(gl, FILTER_FRAGMENT);
    this.copyProgram = createProgram(gl, COPY_FRAGMENT);
    this.lookProgram = createProgram(gl, LOOK_FRAGMENT);
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
      this.layerProgram,
      this.filterProgram,
      this.copyProgram,
      this.lookProgram,
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
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]),
      );
      return t;
    };
    this.baseTextures = Array.from({ length: 6 }, texture);
    this.baseRgbaTextures = Array.from({ length: 2 }, texture);
    this.layerTextures = Array.from({ length: 4 }, texture);
    this.layerRgbaTextures = Array.from({ length: 2 }, texture);
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
    this.bind(BASE_RGBA_UNITS[0], this.baseRgbaTextures[0]!);
    this.bind(BASE_RGBA_UNITS[1], this.baseRgbaTextures[1]!);
    gl.useProgram(this.layerProgram);
    [
      ['backdrop', 0],
      ['ly', 1],
      ['lu', 2],
      ['lv', 3],
      ['image', 4],
      ['maskY', 5],
      ['lrgba', LAYER_RGBA_UNIT],
      ['maskRgba', MASK_RGBA_UNIT],
      ['adjustLut', LUT_UNIT],
      ['fxTexture', BASE_RGBA_UNITS[0]],
    ].forEach(([n, u]) =>
      gl.uniform1i(uniform(gl, this.layerProgram, n as string), u as number),
    );
    this.bind(4, this.layerRgbaTextures[0]!);
    this.bind(5, this.layerTextures[3]!);
    this.bind(LAYER_RGBA_UNIT, this.layerRgbaTextures[0]!);
    this.bind(MASK_RGBA_UNIT, this.layerRgbaTextures[1]!);
    gl.useProgram(this.filterProgram);
    gl.uniform1i(uniform(gl, this.filterProgram, 'backdrop'), 0);
    gl.uniform1i(uniform(gl, this.filterProgram, 'lut'), LUT_UNIT);
    gl.useProgram(this.copyProgram);
    gl.uniform1i(uniform(gl, this.copyProgram, 'source'), 0);
    gl.useProgram(this.lookProgram);
    gl.uniform1i(uniform(gl, this.lookProgram, 'source'), 0);
    gl.uniform1i(uniform(gl, this.lookProgram, 'lut'), LUT_UNIT);
  }

  private baseProgramFor(type: ResolvedTransition['type']): BaseProgramState {
    const cached = this.basePrograms.get(type);
    if (cached) return cached;
    const gl = this.gl;
    const program = createProgram(gl, buildBaseFragment(type));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    ['y0', 'u0', 'v0', 'y1', 'u1', 'v1', 'rgba0', 'rgba1'].forEach((name, unit) =>
      gl.uniform1i(gl.getUniformLocation(program, name), unit),
    );
    const cutUniforms = [0, 1].map((index): CutUniforms => ({
      ...this.adjustFxUniforms(program, String(index)),
      framing: gl.getUniformLocation(program, `framing${index}`),
      transform: gl.getUniformLocation(program, `transform${index}`),
      opacity: gl.getUniformLocation(program, `opacity${index}`),
      format: gl.getUniformLocation(program, `format${index}`),
      sourceSize: gl.getUniformLocation(program, `sourceSize${index}`),
      rotation: gl.getUniformLocation(program, `rotation${index}`),
      layerStyle: gl.getUniformLocation(program, `layerStyle${index}`),
      crop: gl.getUniformLocation(program, `crop${index}`),
      box: gl.getUniformLocation(program, `box${index}`),
      adjustLut: gl.getUniformLocation(program, `adjustLut${index}`),
      hasAdjustLut: gl.getUniformLocation(program, `hasAdjustLut${index}`),
      adjustLutDomainMin: gl.getUniformLocation(program, `adjustLutDomainMin${index}`),
      adjustLutDomainMax: gl.getUniformLocation(program, `adjustLutDomainMax${index}`),
      adjustLutSize: gl.getUniformLocation(program, `adjustLutSize${index}`),
      adjustLutIntensity: gl.getUniformLocation(program, `adjustLutIntensity${index}`),
    }));
    cutUniforms.forEach((cut, index) => gl.uniform1i(cut.adjustLut, BASE_ADJUST_LUT_UNITS[index]!));
    const state: BaseProgramState = {
      program,
      cutUniforms,
      output: uniform(gl, program, 'outputSize'),
      progress: gl.getUniformLocation(program, 'transitionProgress'),
      dissolveNoise: gl.getUniformLocation(program, 'dissolveNoise'),
      secondary: false,
    };
    this.basePrograms.set(type, state);
    return state;
  }

  private bind(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
  }
  private bind3d(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_3D, texture);
  }

  private lookTexture(lut: ParsedCubeLut, allocationUnit = LUT_UNIT): WebGLTexture {
    const cached = this.lookTextures.get(lut);
    if (cached) return cached;
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('WebGL2 could not allocate a 3D LUT texture');
    const gl = this.gl;
    this.bind3d(allocationUnit, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA16F,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      packLutRgba16f(lut),
    );
    this.lookTextures.set(lut, texture);
    this.ownedLookTextures.add(texture);
    return texture;
  }
  private dissolveNoiseTexture(width: number, height: number): WebGLTexture {
    const key = `${width}x${height}`;
    const cached = this.dissolveNoiseTextures.get(key);
    if (cached) return cached;
    const texture = this.gl.createTexture();
    if (!texture)
      throw new Error('WebGL2 could not allocate a dissolve noise texture');
    const gl = this.gl;
    this.bind(DISSOLVE_NOISE_UNIT, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      width,
      height,
      0,
      gl.RED,
      gl.FLOAT,
      dissolveNoiseField(width, height),
    );
    this.dissolveNoiseTextures.set(key, texture);
    return texture;
  }
  get uploadPath(): UploadPath {
    return this.directUploadDisabled ? 'copyTo' : 'direct';
  }
  private failDirectUpload(reason: string): never {
    this.directUploadDisabled = true;
    this.stats.directUploadFallbackReason ??= reason;
    throw new DirectUploadFallbackError(reason);
  }
  private uploadVideoFrameTexture(
    texture: WebGLTexture,
    unit: number,
    frame: VideoFrame,
    uniforms?: CutUniforms,
  ): { width: number; height: number } {
    if (this.directUploadDisabled && !isCopyToPassthroughVideoFormat(frame.format))
      this.failDirectUpload('direct upload is disabled for this session');
    if (!isDirectUploadableFormat(frame.format))
      this.failDirectUpload(`unsupported VideoFrame format: ${String(frame.format)}`);
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const rotation = rotationQuarterTurns(frame);
    const logical = logicalSize(width, height, rotation);
    if (width <= 0 || height <= 0)
      this.failDirectUpload(`invalid display size ${width}x${height}`);
    const gl = this.gl;
    while (gl.getError() !== gl.NO_ERROR) this.stats.glErrors += 1;
    this.bind(unit, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
      gl.BROWSER_DEFAULT_WEBGL,
    );
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame,
      );
    } catch (error) {
      this.failDirectUpload(
        error instanceof Error ? error.message : String(error),
      );
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      this.stats.glErrors += 1;
      this.failDirectUpload(`WebGL error 0x${error.toString(16)}`);
    }
    if (!this.stats.directUploadFrameDimensions) {
      this.stats.directUploadFrameDimensions = {
        codedWidth: frame.codedWidth,
        codedHeight: frame.codedHeight,
        displayWidth: width,
        displayHeight: height,
        visibleRect: frame.visibleRect
          ? {
              x: frame.visibleRect.x,
              y: frame.visibleRect.y,
              width: frame.visibleRect.width,
              height: frame.visibleRect.height,
            }
          : null,
      };
    }
    if (uniforms) {
      gl.uniform1i(uniforms.format, 2);
      gl.uniform2f(uniforms.sourceSize, logical.width, logical.height);
      gl.uniform1i(uniforms.rotation, rotation);
    }
    return logical;
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
    const rotation = rotationQuarterTurns(frame);
    const logical = logicalSize(frame.width, frame.height, rotation);
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
    if (uniforms) {
      this.gl.uniform2f(uniforms.sourceSize, logical.width, logical.height);
      this.gl.uniform1i(uniforms.rotation, rotation);
    }
    for (let i = 0; i < 3; i++) this.bind(unitBase + i, textures[i]!);
    return logical;
  }
  private setCut(
    u: CutUniforms,
    v: ResolvedCutVisual,
    source: { width: number; height: number },
    adjustLutUnit: number,
  ) {
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
    this.configureAdjustLut(v.adjustLut, adjustLutUnit, u);
    this.configureFxResult(null, u);
    // issue #39: layer-style cuts sample through crop / box (layer program geometry); others keep
    // framing / fit untouched. The extra uniforms are inert when layerStyle is 0.
    if (v.layerStyle) {
      const box = cutLayerStyleBox(v, source.width, source.height);
      this.gl.uniform1i(u.layerStyle, 1);
      this.gl.uniform4f(
        u.crop,
        v.layerStyle.crop.x,
        v.layerStyle.crop.y,
        v.layerStyle.crop.width,
        v.layerStyle.crop.height,
      );
      this.gl.uniform2f(u.box, Math.max(box.width, 1e-6), Math.max(box.height, 1e-6));
    } else {
      this.gl.uniform1i(u.layerStyle, 0);
      this.gl.uniform4f(u.crop, 0, 0, 1, 1);
      this.gl.uniform2f(u.box, 1, 1);
    }
  }
  private configureAdjustLut(
    lut: ParsedCubeLut | undefined,
    unit: number,
    uniforms: AdjustLutUniforms,
  ): void {
    const gl = this.gl;
    gl.uniform1i(uniforms.hasAdjustLut, lut ? 1 : 0);
    if (!lut) {
      gl.uniform3f(uniforms.adjustLutDomainMin, 0, 0, 0);
      gl.uniform3f(uniforms.adjustLutDomainMax, 1, 1, 1);
      gl.uniform1f(uniforms.adjustLutSize, 2);
      gl.uniform1f(uniforms.adjustLutIntensity, 0);
      return;
    }
    this.bind3d(unit, this.lookTexture(lut, unit));
    gl.uniform3fv(uniforms.adjustLutDomainMin, lut.domainMin);
    gl.uniform3fv(uniforms.adjustLutDomainMax, lut.domainMax);
    gl.uniform1f(uniforms.adjustLutSize, lut.size);
    gl.uniform1f(uniforms.adjustLutIntensity, 1);
  }
  private adjustFxUniforms(program: WebGLProgram, suffix = ''): AdjustFxUniforms {
    const location = (name: string) => this.gl.getUniformLocation(program, name);
    return { hasFx: location(`hasFx${suffix}`), fxSize: location(`fxSize${suffix}`), fxCrop: location(`fxCrop${suffix}`) };
  }
  private configureFxResult(result: FxResult | null, u: AdjustFxUniforms): void {
    this.gl.uniform1i(u.hasFx, result ? 1 : 0);
    if (!result) return;
    this.gl.uniform2f(u.fxSize, result.size.width, result.size.height);
    this.gl.uniform4f(u.fxCrop, result.crop.x, result.crop.y, result.crop.width, result.crop.height);
  }
  private fxProgram(fragment: string, names: readonly string[]): FxProgram {
    const gl = this.gl;
    const program = createProgram(gl, fragment);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    return { program, locations: Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)])) };
  }
  private createFxTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('WebGL2 could not allocate an fx texture');
    this.bind(FBO_SCRATCH_UNIT, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  private fxPassProgramFor(kind: number): FxProgram {
    let cached = this.fxPassPrograms.get(kind);
    if (!cached) {
      // Keep #version first. Preprocessing removes every other effect before ANGLE
      // translates the shader, avoiding the register cost of the former uber shader.
      const fragment = FX_PASS_FRAGMENT.replace('#version 300 es', `#version 300 es\n#define FX_KIND ${kind}`);
      cached = this.fxProgram(fragment, [
        'source', 'original', 'allocationSize', 'inputSize', 'workSize', 'cropSize', 'fxKind',
        'params', 'direction', 'gaussianWeights[0]', 'tapCount', 'frameIndex',
      ]);
      this.fxPassPrograms.set(kind, cached);
    }
    return cached;
  }
  private allocateFxTexture(texture: WebGLTexture, size: FxSize): void {
    const gl = this.gl;
    this.bind(FBO_SCRATCH_UNIT, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  private ensureFxResources(output: FxSize): void {
    const gl = this.gl;
    if (!this.fxPrepProgram) {
      this.fxPrepProgram = this.fxProgram(FX_PREP_FRAGMENT, [
        'sourceY', 'sourceU', 'sourceV', 'sourceRgba', 'sourceFormat', 'sourceRotation',
        'preserveAlpha', 'sourceSize', 'cropRect', 'adjustLut', 'hasAdjustLut',
        'adjustLutDomainMin', 'adjustLutDomainMax', 'adjustLutSize', 'adjustLutIntensity',
      ]);
      for (let i = 0; i < 2; i++) {
        this.fxTextures.push(this.createFxTexture());
        const fbo = gl.createFramebuffer();
        if (!fbo) throw new Error('WebGL2 could not allocate an fx framebuffer');
        this.fxFbos.push(fbo);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fxTextures[i]!, 0);
      }
    }
    if (output.width <= this.fxAllocation.width && output.height <= this.fxAllocation.height) return;
    this.fxAllocation = { width: Math.max(output.width, this.fxAllocation.width),
      height: Math.max(output.height, this.fxAllocation.height) };
    for (const texture of this.fxTextures) this.allocateFxTexture(texture, this.fxAllocation);
    if (this.fxOriginalTexture) this.allocateFxTexture(this.fxOriginalTexture, this.fxAllocation);
  }
  private runFxPasses(
    passes: readonly FxPass[], source: FxSource, output: FxSize, frameIndex: number, draw: () => void,
  ): FxResult {
    this.options.passTimer?.('prep');
    this.ensureFxResources(output);
    const gl = this.gl;
    const work = fxWorkingSize(source.size, source.crop, output);
    const needsOriginal = passes.some(pass => pass.effect.id === 'glow' || pass.effect.id === 'clarity');
    if (needsOriginal && !this.fxOriginalTexture) {
      this.fxOriginalTexture = this.createFxTexture();
      this.allocateFxTexture(this.fxOriginalTexture, this.fxAllocation);
    }
    const prep = this.fxPrepProgram!, p = prep.locations;
    gl.useProgram(prep.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fxFbos[0]!);
    gl.viewport(0, 0, work.width, work.height);
    gl.uniform1i(p.sourceY!, source.yuvUnits[0]!);
    gl.uniform1i(p.sourceU!, source.yuvUnits[1]!);
    gl.uniform1i(p.sourceV!, source.yuvUnits[2]!);
    gl.uniform1i(p.sourceRgba!, source.rgbaUnit);
    gl.uniform1i(p.sourceFormat!, source.format);
    gl.uniform1i(p.sourceRotation!, source.rotation);
    gl.uniform1i(p.preserveAlpha!, source.preserveAlpha ? 1 : 0);
    gl.uniform2f(p.sourceSize!, source.size.width, source.size.height);
    gl.uniform4f(p.cropRect!, source.crop.x, source.crop.y, source.crop.width, source.crop.height);
    gl.uniform1i(p.adjustLut!, source.lutUnit);
    this.configureAdjustLut(source.lut, source.lutUnit, {
      hasAdjustLut: p.hasAdjustLut!, adjustLutDomainMin: p.adjustLutDomainMin!,
      adjustLutDomainMax: p.adjustLutDomainMax!, adjustLutSize: p.adjustLutSize!,
      adjustLutIntensity: p.adjustLutIntensity!,
    });
    draw();
    this.bind(FX_ORIGINAL_UNIT, this.fxOriginalTexture ?? this.baseRgbaTextures[0]!);
    let current = 0;
    let inputSize = work;
    for (const { stage, effect } of passes) {
      this.options.passTimer?.(stage === 'gaussian-h' ? 'blur-h' : stage === 'gaussian-v' ? 'blur-v' : stage);
      if (stage === 'bright-pass' || (effect.id === 'clarity' && stage === 'gaussian-h')) {
        // Preserve this effect's input, including all earlier effects, without a third FBO.
        this.bind(FBO_SCRATCH_UNIT, this.fxOriginalTexture!);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fxFbos[current]!);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, work.width, work.height);
      }
      const next = 1 - current;
      let targetSize = work;
      const kind = FX_PASS_KINDS[stage];
      const passProgram = this.fxPassProgramFor(kind), u = passProgram.locations;
      gl.useProgram(passProgram.program);
      // Uniform state belongs to each program. Refresh all common inputs after
      // binding, even on cache hits and when H/V reuse the same Gaussian program.
      gl.uniform1i(u.source!, FBO_SCRATCH_UNIT);
      gl.uniform1i(u.original!, FX_ORIGINAL_UNIT);
      gl.uniform2f(u.allocationSize!, this.fxAllocation.width, this.fxAllocation.height);
      gl.uniform2f(u.workSize!, work.width, work.height);
      gl.uniform2f(u.cropSize!, source.size.width * source.crop.width, source.size.height * source.crop.height);
      gl.uniform1ui(u.frameIndex!, frameIndex);
      gl.uniform2f(u.inputSize!, inputSize.width, inputSize.height);
      gl.uniform1i(u.fxKind!, kind);
      switch (effect.id) {
        case 'vignette':
          gl.uniform4f(u.params!, effect.amount, effect.midpoint, effect.roundness, effect.feather);
          break;
        case 'grain':
          gl.uniform4f(u.params!, effect.amount, effect.size, 0, 0);
          break;
        case 'sharpen':
          gl.uniform4f(u.params!, effect.amount, 0, 0, 0);
          break;
        case 'blur':
        case 'glow':
        case 'clarity': {
          if (stage === 'bright-pass' || stage === 'glow-composite') {
            if (effect.id !== 'glow') throw new Error('Invalid glow pass');
            gl.uniform4f(u.params!, effect.intensity, effect.radius, effect.threshold, effect.warmth);
            break;
          }
          if (stage === 'clarity-composite') {
            if (effect.id !== 'clarity') throw new Error('Invalid clarity pass');
            gl.uniform4f(u.params!, effect.amount, 0, 0, 0);
            break;
          }
          const geometry = fxGaussianGeometry(effect.id === 'blur' ? effect.px : effect.radius,
            output.width, work, source.displayed);
          const horizontal = stage === 'gaussian-h';
          if (horizontal) targetSize = geometry.reduced;
          const radius = horizontal ? geometry.radiusX : geometry.radiusY;
          let kernel = this.fxWeightCache.get(radius);
          if (!kernel) {
            kernel = fxGaussianWeights(radius);
            // Animated radii must not grow a session-long cache without bound.
            if (this.fxWeightCache.size >= 64) this.fxWeightCache.clear();
            this.fxWeightCache.set(radius, kernel);
          }
          gl.uniform1fv(u['gaussianWeights[0]']!, kernel.weights);
          gl.uniform1i(u.tapCount!, kernel.tapCount);
          gl.uniform2f(u.direction!, horizontal ? 1 / geometry.reduced.width : 0,
            horizontal ? 0 : 1 / geometry.reduced.height);
          break;
        }
        case 'dehaze':
        case 'denoise':
          gl.uniform4f(u.params!, effect.amount, 0, 0, 0);
          break;
        case 'motion_blur': {
          const length = effect.px * output.width / 1920;
          const angle = effect.angle * Math.PI / 180;
          gl.uniform2f(u.direction!, Math.cos(angle) * length / Math.max(source.displayed.width, 1e-6),
            Math.sin(angle) * length / Math.max(source.displayed.height, 1e-6));
          break;
        }
      }
      this.bind(FBO_SCRATCH_UNIT, this.fxTextures[current]!);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fxFbos[next]!);
      gl.viewport(0, 0, targetSize.width, targetSize.height);
      draw();
      current = next;
      inputSize = targetSize;
    }
    this.options.passTimer?.(null);
    return { texture: this.fxTextures[current]!, size: work, crop: source.crop };
  }
  private snapshotBaseFx(index: number, result: FxResult): FxResult {
    this.options.passTimer?.('snapshot-copy');
    const gl = this.gl;
    let snapshot = this.baseFxTextures[index];
    if (!snapshot) {
      snapshot = { texture: this.createFxTexture(), allocation: { width: 0, height: 0 } };
      this.baseFxTextures[index] = snapshot;
    }
    if (snapshot.allocation.width !== this.fxAllocation.width || snapshot.allocation.height !== this.fxAllocation.height) {
      this.allocateFxTexture(snapshot.texture, this.fxAllocation);
      snapshot.allocation = { ...this.fxAllocation };
    }
    this.bind(FBO_SCRATCH_UNIT, snapshot.texture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, result.size.width, result.size.height);
    this.options.passTimer?.(null);
    return { ...result, texture: snapshot.texture };
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
  /** 静止画 cut（issue #30）: layers と同じ texture cache を base の RGBA unit へ結び、format 2 で標本化する。 */
  private uploadStillBaseTexture(
    value: StillImageBitmap,
    unit: number,
    uniforms?: CutUniforms,
  ): { width: number; height: number } {
    const texture = this.stillTexture(value);
    this.bind(unit, texture);
    if (uniforms) {
      this.gl.uniform1i(uniforms.format, 2);
      this.gl.uniform2f(uniforms.sourceSize, value.width, value.height);
      this.gl.uniform1i(uniforms.rotation, 0);
    }
    return { width: value.width, height: value.height };
  }
  private prepareBase(
    frames: readonly (NativeYuvFrame | StillImageBitmap | VideoFrame)[],
    plan: EvaluationPlan,
    output: EvaluationPlan['output'],
    baseProgram: BaseProgramState,
  ): number {
    const gl = this.gl;
    gl.useProgram(baseProgram.program);
    gl.uniform2f(baseProgram.output, output.width, output.height);
    const started = performance.now();
    // Logical (display-rotated) source sizes per slot: the layer-style box (issue #39) is crop × size × scale.
    const sizes: { width: number; height: number }[] = [];
    frames.forEach((frame, index) => {
      if ('bitmap' in frame) {
        sizes[index] = this.uploadStillBaseTexture(frame, BASE_RGBA_UNITS[index]!, baseProgram.cutUniforms[index]);
      } else if (isVideoFrame(frame)) {
        sizes[index] = this.uploadVideoFrameTexture(
          this.baseRgbaTextures[index]!,
          BASE_RGBA_UNITS[index]!,
          frame,
          baseProgram.cutUniforms[index],
        );
      } else {
        // RGBA is an active sampler even in the YUV branch. A prior layer may have
        // left a shared fx attachment on this unit; never let prep sample its target.
        this.bind(BASE_RGBA_UNITS[index]!, this.baseRgbaTextures[index]!);
        sizes[index] = this.uploadYuv(
          frame,
          this.baseTextures.slice(index * 3, index * 3 + 3),
          index * 3,
          index * 3,
          baseProgram.cutUniforms[index],
        );
      }
    });
    if (frames.length === 1 && !baseProgram.secondary) {
      const frame = frames[0]!;
      if ('bitmap' in frame) {
        this.uploadStillBaseTexture(frame, BASE_RGBA_UNITS[1], baseProgram.cutUniforms[1]);
      } else if (isVideoFrame(frame)) {
        const rotation = rotationQuarterTurns(frame);
        const logical = logicalSize(frame.displayWidth, frame.displayHeight, rotation);
        this.bind(BASE_RGBA_UNITS[1], this.baseRgbaTextures[0]!);
        this.gl.uniform1i(baseProgram.cutUniforms[1]!.format, 2);
        this.gl.uniform2f(
          baseProgram.cutUniforms[1]!.sourceSize,
          logical.width,
          logical.height,
        );
        this.gl.uniform1i(baseProgram.cutUniforms[1]!.rotation, rotation);
      } else {
        this.uploadYuv(
          frame,
          this.baseTextures.slice(3, 6),
          3,
          3,
          baseProgram.cutUniforms[1],
        );
      }
      baseProgram.secondary = true;
    } else if (frames.length === 2) {
      baseProgram.secondary = true;
    }
    const elapsed = performance.now() - started;
    frames.forEach((_frame, index) =>
      this.setCut(
        baseProgram.cutUniforms[index]!, plan.base[index]!.visual, sizes[index]!,
        BASE_ADJUST_LUT_UNITS[index]!,
      ),
    );
    if (frames.length === 1)
      this.setCut(
        baseProgram.cutUniforms[1]!, plan.base[0]!.visual, sizes[0]!, BASE_ADJUST_LUT_UNITS[1],
      );
    return elapsed;
  }

  private configureBaseDraw(
    plan: EvaluationPlan,
    target: WebGLFramebuffer | null,
    baseProgram: BaseProgramState,
  ): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target);
    this.gl.viewport(0, 0, plan.output.width, plan.output.height);
    this.gl.useProgram(baseProgram.program);
    this.gl.uniform1f(baseProgram.progress, plan.transition?.progress ?? 0);
    if (baseProgram.dissolveNoise) {
      this.bind(
        DISSOLVE_NOISE_UNIT,
        this.dissolveNoiseTexture(plan.output.width, plan.output.height),
      );
      this.gl.uniform1i(baseProgram.dissolveNoise, DISSOLVE_NOISE_UNIT);
    }
  }

  private prepareBaseFx(
    frames: readonly (NativeYuvFrame | StillImageBitmap | VideoFrame)[],
    plan: EvaluationPlan, baseProgram: BaseProgramState, draw: () => void,
  ): void {
    const output = plan.output;
    frames.forEach((frame, index) => {
      const visual = plan.base[index]!.visual;
      const passes = planFxPasses(visual.adjustFx);
      if (!passes.length) return;
      const still = 'bitmap' in frame;
      const video = isVideoFrame(frame);
      const rotation = still ? 0 : rotationQuarterTurns(frame);
      const size = still ? { width: frame.width, height: frame.height }
        : video ? logicalSize(frame.displayWidth, frame.displayHeight, rotation)
        : logicalSize(frame.width, frame.height, rotation);
      const fit = Math.min(output.width / size.width, output.height / size.height);
      const framing = visual.framing;
      const axis = (start: number, length: number, source: number, out: number) => {
        const offset = (out - source * fit) * 0.5;
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        const lo = clamp((start * out - offset) / (source * fit));
        const hi = clamp(((start + length) * out - offset) / (source * fit));
        return [lo, Math.max(hi - lo, 1e-6)];
      };
      const x = axis(framing.x, framing.width, size.width, output.width);
      const y = axis(framing.y, framing.height, size.height, output.height);
      const crop = visual.layerStyle?.crop ?? { x: x[0]!, y: y[0]!, width: x[1]!, height: y[1]! };
      const displayed = visual.layerStyle ? cutLayerStyleBox(visual, size.width, size.height) : {
        width: crop.width * size.width * fit * visual.transform.scale / framing.width,
        height: crop.height * size.height * fit * visual.transform.scale / framing.height,
      };
      const result = this.snapshotBaseFx(index, this.runFxPasses(passes, {
        size, crop, displayed, format: still || video ? 2 : frame.format === 'NV12' ? 1 : 0,
        rotation, rgbaUnit: BASE_RGBA_UNITS[index]!, yuvUnits: [index * 3, index * 3 + 1, index * 3 + 2],
        preserveAlpha: false, lut: visual.adjustLut, lutUnit: BASE_ADJUST_LUT_UNITS[index]!,
      }, output, adjustFxFrameIndex(plan), draw));
      this.gl.useProgram(baseProgram.program);
      this.bind(BASE_RGBA_UNITS[index]!, result.texture);
      this.configureFxResult(result, baseProgram.cutUniforms[index]!);
      if (frames.length === 1) {
        this.bind(BASE_RGBA_UNITS[1], result.texture);
        this.configureFxResult(result, baseProgram.cutUniforms[1]!);
      }
    });
  }

  async compose(
    base: readonly (NativeYuvFrame | StillImageBitmap | VideoFrame)[],
    layers: readonly CompositorLayerInput[],
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
    const hasBlockedDirectInput = base.some(frame =>
      isVideoFrame(frame) && !isCopyToPassthroughVideoFormat(frame.format)) || layers.some(input =>
      input.kind !== 'filter' && ((isVideoFrame(input.color) && !isCopyToPassthroughVideoFormat(input.color.format))
      || Boolean(input.mask && isVideoFrame(input.mask)
        && !isCopyToPassthroughVideoFormat(input.mask.format))));
    if (hasBlockedDirectInput && this.directUploadDisabled)
      this.failDirectUpload('direct upload is disabled for this session');
    if (this.canvas.width !== output.width) this.canvas.width = output.width;
    if (this.canvas.height !== output.height)
      this.canvas.height = output.height;

    const gl = this.gl;
    gl.viewport(0, 0, output.width, output.height);
    const look = output.look ?? null;
    const lookIntensity = look
      ? Math.max(0, Math.min(1, Number.isFinite(look.intensity) ? look.intensity : 1))
      : 0;
    const hasLook = look !== null && lookIntensity > 0;
    this.options.passTimer?.('base-prepare');
    const baseProgram = base.length > 0
      ? this.baseProgramFor(plan.transition?.type ?? 'hard-cut')
      : null;
    let uploadElapsedMs =
      baseProgram ? this.prepareBase(base, plan, output, baseProgram) : 0;
    this.options.passTimer?.(null);
    let shaderElapsedMs = 0;
    const synchronization = this.options.synchronization ?? 'finish';
    const timer =
      synchronization === 'finish' && !this.options.passTimer
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

    if (baseProgram) this.prepareBaseFx(base, plan, baseProgram, draw);

    // The no-layers path deliberately keeps the original direct-to-default-framebuffer draw.
    // Avoiding an FBO here structurally preserves the existing 28 golden frames byte-for-byte.
    // An empty base has no program, so let it fall through to the existing FBO black-clear path.
    if (layers.length === 0 && !hasLook && baseProgram) {
      this.options.passTimer?.('base-draw');
      this.configureBaseDraw(plan, null, baseProgram!);
      draw();
      this.options.passTimer?.(null);
      this.recordGlErrors(synchronization);
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
    if (baseProgram) {
      this.options.passTimer?.('base-draw');
      this.configureBaseDraw(plan, this.fbos[0]!, baseProgram);
      draw();
      this.options.passTimer?.(null);
      this.recordGlErrors(synchronization);
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
    const maskFormatLoc = uniform(gl, this.layerProgram, 'maskFormat');
    const layerRotationLoc = uniform(gl, this.layerProgram, 'layerRotation');
    const maskRotationLoc = uniform(gl, this.layerProgram, 'maskRotation');
    const blendLoc = uniform(gl, this.layerProgram, 'blendMode');
    const layerAdjustUniforms: AdjustLutUniforms = {
      hasAdjustLut: uniform(gl, this.layerProgram, 'hasAdjustLut'),
      adjustLutDomainMin: uniform(gl, this.layerProgram, 'adjustLutDomainMin'),
      adjustLutDomainMax: uniform(gl, this.layerProgram, 'adjustLutDomainMax'),
      adjustLutSize: uniform(gl, this.layerProgram, 'adjustLutSize'),
      adjustLutIntensity: uniform(gl, this.layerProgram, 'adjustLutIntensity'),
    };
    const layerFxUniforms = this.adjustFxUniforms(this.layerProgram);
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
      const layer = plan.layers[index]!;
      const next = 1 - current;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[next]!);
      if (input.kind === 'filter') {
        if (layer.kind !== 'filter') throw new Error(`filter input ${index} does not match plan layer`);
        this.configureFilterDraw(layer, output, current);
        draw();
        this.recordGlErrors(synchronization);
        current = next;
        continue;
      }
      if (layer.kind === 'filter') throw new Error(`media input ${index} does not match filter plan layer`);
      const color = input.color;
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
        gl.uniform1i(layerRotationLoc, 0);
      } else if (isVideoFrame(color)) {
        const size = this.uploadVideoFrameTexture(
          this.layerRgbaTextures[0]!,
          LAYER_RGBA_UNIT,
          color,
        );
        width = size.width;
        height = size.height;
        gl.uniform1i(kindLoc, 0);
        gl.uniform1i(formatLoc, 2);
        gl.uniform1i(layerRotationLoc, rotationQuarterTurns(color));
      } else {
        const size = this.uploadYuv(color, this.layerTextures.slice(0, 3), 1, 6);
        width = size.width;
        height = size.height;
        gl.uniform1i(kindLoc, 0);
        gl.uniform1i(formatLoc, color.format === 'NV12' ? 1 : 0);
        gl.uniform1i(layerRotationLoc, rotationQuarterTurns(color));
      }
      if (input.mask) {
        if (isVideoFrame(input.mask)) {
          this.uploadVideoFrameTexture(
            this.layerRgbaTextures[1]!,
            MASK_RGBA_UNIT,
            input.mask,
          );
          gl.uniform1i(maskFormatLoc, 2);
          gl.uniform1i(maskRotationLoc, rotationQuarterTurns(input.mask));
        } else {
          this.upload(
            this.layerTextures[3]!,
            9,
            input.mask.y,
            input.mask.width,
            input.mask.height,
          );
          this.bind(5, this.layerTextures[3]!);
          gl.uniform1i(maskFormatLoc, input.mask.format === 'NV12' ? 1 : 0);
          gl.uniform1i(maskRotationLoc, rotationQuarterTurns(input.mask));
        }
        gl.uniform1i(hasMaskLoc, 1);
      } else {
        gl.uniform1i(hasMaskLoc, 0);
        gl.uniform1i(maskFormatLoc, 0);
        gl.uniform1i(maskRotationLoc, 0);
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
      this.configureAdjustLut(layer.adjustLut, LUT_UNIT, layerAdjustUniforms);
      const passes = planFxPasses(layer.adjustFx);
      let fxResult: FxResult | null = null;
      if (passes.length) {
        const crop = layer.visual.crop;
        const inverse = forwardInverse(layer.visual, width, height, output.width, output.height);
        fxResult = this.runFxPasses(passes, {
          size: { width, height }, crop, displayed: fxDisplayedSize(inverse),
          format: 'bitmap' in color || isVideoFrame(color) ? 2 : color.format === 'NV12' ? 1 : 0,
          rotation: 'bitmap' in color ? 0 : rotationQuarterTurns(color),
          rgbaUnit: 'bitmap' in color ? 4 : LAYER_RGBA_UNIT, yuvUnits: [1, 2, 3],
          preserveAlpha: 'bitmap' in color, lut: layer.adjustLut, lutUnit: LUT_UNIT,
        }, output, adjustFxFrameIndex(plan), draw);
        this.bind(BASE_RGBA_UNITS[0], fxResult.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[next]!);
        gl.viewport(0, 0, output.width, output.height);
        gl.useProgram(this.layerProgram);
      }
      this.configureFxResult(fxResult, layerFxUniforms);
      draw();
      this.recordGlErrors(synchronization);
      current = next;
    }

    // Copy, or apply the optional final 3D LUT, to the visible/default framebuffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bind(0, this.fboTextures[current]!);
    if (hasLook && look) {
      gl.useProgram(this.lookProgram);
      this.bind3d(LUT_UNIT, this.lookTexture(look.lut));
      gl.uniform3fv(uniform(gl, this.lookProgram, 'lutDomainMin'), look.lut.domainMin);
      gl.uniform3fv(uniform(gl, this.lookProgram, 'lutDomainMax'), look.lut.domainMax);
      gl.uniform1f(uniform(gl, this.lookProgram, 'lutSize'), look.lut.size);
      gl.uniform1f(uniform(gl, this.lookProgram, 'lutIntensity'), lookIntensity);
    } else {
      gl.useProgram(this.copyProgram);
    }
    draw();
    this.recordGlErrors(synchronization);
    // Unit 0 is also the active base program's y0. Do not leave an FBO attachment there: the next direct-upload
    // frame does not touch unit 0 before drawing its base into fbos[0].
    this.bind(0, this.baseTextures[0]!);
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

  private configureFilterDraw(
    layer: ResolvedFilterLayer,
    output: EvaluationPlan['output'],
    backdropIndex: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.filterProgram);
    this.bind(0, this.fboTextures[backdropIndex]!);
    const filterType = layer.filter.type === 'invert' ? 0 : layer.filter.type === 'saturation' ? 1 : 2;
    gl.uniform1i(uniform(gl, this.filterProgram, 'filterType'), filterType);
    gl.uniform1f(
      uniform(gl, this.filterProgram, 'value'),
      layer.filter.type === 'saturation' ? layer.filter.value : 1,
    );
    gl.uniform1f(uniform(gl, this.filterProgram, 'opacity'), layer.opacity);
    gl.uniform1f(uniform(gl, this.filterProgram, 'edgePx'), 2);
    gl.uniform2f(uniform(gl, this.filterProgram, 'outputSize'), output.width, output.height);
    gl.uniform2fv(
      uniform(gl, this.filterProgram, 'corners[0]'),
      new Float32Array(layer.corners.flatMap(corner => [corner[0] * output.width, corner[1] * output.height])),
    );
    if (layer.filter.type === 'lut') {
      const intensity = Math.max(0, Math.min(1,
        Number.isFinite(layer.filter.intensity) ? Number(layer.filter.intensity) : 1));
      this.bind3d(LUT_UNIT, this.lookTexture(layer.filter.lut));
      gl.uniform3fv(uniform(gl, this.filterProgram, 'lutDomainMin'), layer.filter.lut.domainMin);
      gl.uniform3fv(uniform(gl, this.filterProgram, 'lutDomainMax'), layer.filter.lut.domainMax);
      gl.uniform1f(uniform(gl, this.filterProgram, 'lutSize'), layer.filter.lut.size);
      gl.uniform1f(uniform(gl, this.filterProgram, 'lutIntensity'), intensity);
    } else {
      gl.uniform3f(uniform(gl, this.filterProgram, 'lutDomainMin'), 0, 0, 0);
      gl.uniform3f(uniform(gl, this.filterProgram, 'lutDomainMax'), 1, 1, 1);
      gl.uniform1f(uniform(gl, this.filterProgram, 'lutSize'), 2);
      gl.uniform1f(uniform(gl, this.filterProgram, 'lutIntensity'), 0);
    }
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
      ...this.baseRgbaTextures,
      ...this.layerTextures,
      ...this.layerRgbaTextures,
      ...this.fboTextures,
      ...this.fxTextures,
      ...(this.fxOriginalTexture ? [this.fxOriginalTexture] : []),
      ...this.baseFxTextures.flatMap(value => value ? [value.texture] : []),
      ...this.ownedImageTextures,
      ...this.ownedLookTextures,
      ...this.dissolveNoiseTextures.values(),
    ])
      this.gl.deleteTexture(t);
    for (const f of this.fbos) this.gl.deleteFramebuffer(f);
    for (const f of this.fxFbos) this.gl.deleteFramebuffer(f);
    if (this.fxPrepProgram) this.gl.deleteProgram(this.fxPrepProgram.program);
    for (const value of this.fxPassPrograms.values()) this.gl.deleteProgram(value.program);
    this.fxPassPrograms.clear();
    this.gl.deleteBuffer(this.vertices);
    for (const value of this.basePrograms.values())
      this.gl.deleteProgram(value.program);
    this.basePrograms.clear();
    this.dissolveNoiseTextures.clear();
    this.gl.deleteProgram(this.layerProgram);
    this.gl.deleteProgram(this.filterProgram);
    this.gl.deleteProgram(this.copyProgram);
    this.gl.deleteProgram(this.lookProgram);
  }
}
