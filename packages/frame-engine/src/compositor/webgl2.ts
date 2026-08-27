import type {
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  GPUFrameSurface,
  NativeYuvFrame,
  ResolvedCutVisual,
  ResolvedLayerVisual,
  StillImageBitmap,
  UploadPath,
} from '../types.js';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import type { ParsedCubeLut } from '../look/cube.js';
import { cornersToHomography, invertMat3 } from '../timeline/layer-visual.js';

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
  uploadPath?: UploadPath;
}

export class DirectUploadFallbackError extends Error {
  constructor(readonly reason: string) {
    super(`direct VideoFrame upload failed: ${reason}`);
    this.name = 'DirectUploadFallbackError';
  }
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
  if (format0 == 2) return vec4(texture(rgba0, q).rgb, opacity0);
  vec2 chroma = format0 == 1 ? texture(u0, q).rg : vec2(texture(u0, q).r, texture(v0, q).r);
  return vec4(yuv709(texture(y0, q).r, chroma), opacity0);
}
vec4 sample1(vec2 p) {
  vec2 canvasPoint = inverseVisual(p, transform1, framing1);
  if (canvasPoint.x < framing1.x || canvasPoint.x > framing1.x + framing1.z || canvasPoint.y < framing1.y || canvasPoint.y > framing1.y + framing1.w) return vec4(0.0);
  vec2 q = canvasToSource(canvasPoint, sourceSize1);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  if (format1 == 2) return vec4(texture(rgba1, q).rgb, opacity1);
  vec2 chroma = format1 == 1 ? texture(u1, q).rg : vec2(texture(u1, q).r, texture(v1, q).r);
  return vec4(yuv709(texture(y1, q).r, chroma), opacity1);
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
vec3 horizontalBlur(bool incoming, vec2 ip, int size) {
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
void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  vec2 ip = floor(p * outputSize);
  float amount = clamp(transitionProgress, 0.0, 1.0);
  float P = 1.0 - amount;
  vec3 result;
  if (transitionType == ${TRANSITION_CODES['hard-cut']}) {
    result = A(p);
  } else if (transitionType == ${TRANSITION_CODES.dissolve} || transitionType == ${TRANSITION_CODES.fade}) {
    result = mixFf(A(p), B(p), P);
  } else if (transitionType == ${TRANSITION_CODES['fade-black']} || transitionType == ${TRANSITION_CODES['fade-white']}) {
    vec3 plate = transitionType == ${TRANSITION_CODES['fade-white']} ? vec3(1.0) : vec3(0.0);
    result = amount < 0.5
      ? mix(A(p), plate, amount * 2.0)
      : mix(plate, B(p), (amount - 0.5) * 2.0);
  } else if (transitionType == ${TRANSITION_CODES['fade-grays']}) {
    const float phase = 0.2;
    vec3 a = A(p), b = B(p);
    vec3 ga = vec3(dot(a, vec3(0.2126, 0.7152, 0.0722)));
    vec3 gb = vec3(dot(b, vec3(0.2126, 0.7152, 0.0722)));
    result = mixFf(
      mixFf(a, ga, smoothstep(1.0 - phase, 1.0, P)),
      mixFf(gb, b, smoothstep(phase, 1.0, P)), P);
  } else if (transitionType == ${TRANSITION_CODES['wipe-left']}
      || transitionType == ${TRANSITION_CODES['wipe-right']}
      || transitionType == ${TRANSITION_CODES['wipe-up']}
      || transitionType == ${TRANSITION_CODES['wipe-down']}) {
    float z;
    bool useA;
    if (transitionType == ${TRANSITION_CODES['wipe-left']}) { z = trunc(P * outputSize.x); useA = ip.x <= z; }
    else if (transitionType == ${TRANSITION_CODES['wipe-right']}) { z = trunc((1.0 - P) * outputSize.x); useA = ip.x > z; }
    else if (transitionType == ${TRANSITION_CODES['wipe-up']}) { z = trunc(P * outputSize.y); useA = ip.y <= z; }
    else { z = trunc((1.0 - P) * outputSize.y); useA = ip.y > z; }
    result = useA ? A(p) : B(p);
  } else if (transitionType == ${TRANSITION_CODES.radial}) {
    float s = smoothstep(0.0, 1.0,
      atan(ip.x - outputSize.x * 0.5, ip.y - outputSize.y * 0.5)
      - (P - 0.5) * (3.141592653589793 * 2.5));
    result = B(p) * s + A(p) * (1.0 - s);
  } else if (transitionType == ${TRANSITION_CODES['slide-left']}
      || transitionType == ${TRANSITION_CODES['slide-right']}
      || transitionType == ${TRANSITION_CODES['slide-up']}
      || transitionType == ${TRANSITION_CODES['slide-down']}
      || transitionType == ${TRANSITION_CODES['cover-left']}
      || transitionType == ${TRANSITION_CODES['cover-right']}
      || transitionType == ${TRANSITION_CODES['cover-up']}
      || transitionType == ${TRANSITION_CODES['cover-down']}
      || transitionType == ${TRANSITION_CODES['reveal-left']}
      || transitionType == ${TRANSITION_CODES['reveal-right']}
      || transitionType == ${TRANSITION_CODES['reveal-up']}
      || transitionType == ${TRANSITION_CODES['reveal-down']}) {
    bool horizontal = transitionType == ${TRANSITION_CODES['slide-left']}
      || transitionType == ${TRANSITION_CODES['slide-right']}
      || transitionType == ${TRANSITION_CODES['cover-left']}
      || transitionType == ${TRANSITION_CODES['cover-right']}
      || transitionType == ${TRANSITION_CODES['reveal-left']}
      || transitionType == ${TRANSITION_CODES['reveal-right']};
    bool negative = transitionType == ${TRANSITION_CODES['slide-left']}
      || transitionType == ${TRANSITION_CODES['slide-up']}
      || transitionType == ${TRANSITION_CODES['cover-left']}
      || transitionType == ${TRANSITION_CODES['cover-up']}
      || transitionType == ${TRANSITION_CODES['reveal-left']}
      || transitionType == ${TRANSITION_CODES['reveal-up']};
    float extent = horizontal ? outputSize.x : outputSize.y;
    float index = horizontal ? ip.x : ip.y;
    float z = trunc((negative ? -P : P) * extent);
    float shifted = z + index;
    float wrapped = wrapPixel(shifted, extent);
    bool inside = shifted >= 0.0 && shifted < extent;
    vec2 moved = horizontal ? texelOf(vec2(wrapped, ip.y)) : texelOf(vec2(ip.x, wrapped));
    bool slide = transitionType == ${TRANSITION_CODES['slide-left']}
      || transitionType == ${TRANSITION_CODES['slide-right']}
      || transitionType == ${TRANSITION_CODES['slide-up']}
      || transitionType == ${TRANSITION_CODES['slide-down']};
    bool cover = transitionType == ${TRANSITION_CODES['cover-left']}
      || transitionType == ${TRANSITION_CODES['cover-right']}
      || transitionType == ${TRANSITION_CODES['cover-up']}
      || transitionType == ${TRANSITION_CODES['cover-down']};
    if (slide) result = inside ? B(moved) : A(moved);
    else if (cover) result = inside ? B(moved) : A(p);
    else result = inside ? B(p) : A(moved);
  } else if (transitionType == ${TRANSITION_CODES['circle-open']} || transitionType == ${TRANSITION_CODES['circle-close']}) {
    float radius = length(outputSize * 0.5);
    float pp = transitionType == ${TRANSITION_CODES['circle-open']} ? (P - 0.5) * 3.0 : (1.0 - P - 0.5) * 3.0;
    float s = smoothstep(0.0, 1.0, length(ip - outputSize * 0.5) / radius + pp);
    result = transitionType == ${TRANSITION_CODES['circle-open']}
      ? A(p) * s + B(p) * (1.0 - s)
      : B(p) * s + A(p) * (1.0 - s);
  } else if (transitionType == ${TRANSITION_CODES['zoom-in']}) {
    float zf = smoothstep(0.5, 1.0, P);
    vec2 unit = vec2(
      0.5 + (ip.x / outputSize.x - 0.5) * zf,
      0.5 + (ip.y / outputSize.y - 0.5) * zf);
    vec2 sourcePixel = ceil(unit * (outputSize - 1.0));
    float s = smoothstep(0.0, 0.5, P);
    result = A(texelOf(sourcePixel)) * s + B(p) * (1.0 - s);
  } else if (transitionType == ${TRANSITION_CODES['squeeze-h']}) {
    float zr = 0.5 + (ip.y / outputSize.y - 0.5) / max(P, 0.000001);
    result = (P <= 0.0 || zr < 0.0 || zr > 1.0)
      ? B(p) : A(texelOf(vec2(ip.x, floor(zr * (outputSize.y - 1.0) + 0.5))));
  } else if (transitionType == ${TRANSITION_CODES['squeeze-v']}) {
    float zc = 0.5 + (ip.x / outputSize.x - 0.5) / max(P, 0.000001);
    result = (P <= 0.0 || zc < 0.0 || zc > 1.0)
      ? B(p) : A(texelOf(vec2(floor(zc * (outputSize.x - 1.0) + 0.5), ip.y)));
  } else if (transitionType == ${TRANSITION_CODES.blur}) {
    float prog = P <= 0.5 ? P * 2.0 : (1.0 - P) * 2.0;
    int size = 1 + int(trunc((outputSize.x * 0.5) * prog));
    // xfade uses the complete causal box. The fixed tap cap keeps this one-pass GPU path bounded.
    result = horizontalBlur(false, ip, size) * P + horizontalBlur(true, ip, size) * (1.0 - P);
  } else if (transitionType == ${TRANSITION_CODES.pixelize}) {
    float d = min(P, 1.0 - P);
    float dist = ceil(d * 50.0) / 50.0;
    float sq = 2.0 * dist * min(outputSize.x, outputSize.y) / 20.0;
    float sx = dist > 0.0
      ? min(trunc(floor(ip.x / sq) * sq + 0.5 * sq), outputSize.x - 1.0) : ip.x;
    float sy = dist > 0.0
      ? min(trunc(floor(ip.y / sq) * sq + 0.5 * sq), outputSize.y - 1.0) : ip.y;
    vec2 q = texelOf(vec2(sx, sy));
    result = A(q) * P + B(q) * (1.0 - P);
  } else {
    result = A(p);
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
uniform sampler2D lrgba;
uniform sampler2D maskRgba;
uniform int inputKind;
uniform int yuvFormat;
uniform int hasMask;
uniform int maskFormat;
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
  } else if (yuvFormat == 2) {
    src = vec4(texture(lrgba, sourceUv).rgb, 1.0);
  } else {
    vec2 chroma = yuvFormat == 1
      ? texture(lu, sourceUv).rg
      : vec2(texture(lu, sourceUv).r, texture(lv, sourceUv).r);
    src = vec4(yuv709(texture(ly, sourceUv).r, chroma), 1.0);
  }
  float maskA = hasMask == 1
    ? (maskFormat == 2 ? texture(maskRgba, sourceUv).r : texture(maskY, sourceUv).r)
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

const FBO_SCRATCH_UNIT = 9;
const BASE_RGBA_UNITS = [6, 7] as const;
const LAYER_RGBA_UNIT = 8;
const MASK_RGBA_UNIT = 10;
const LUT_UNIT = 11;
const REQUIRED_TEXTURE_UNITS = LUT_UNIT + 1;

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
  private readonly baseProgram: WebGLProgram;
  private readonly layerProgram: WebGLProgram;
  private readonly copyProgram: WebGLProgram;
  private readonly lookProgram: WebGLProgram;
  private readonly vertices: WebGLBuffer;
  private readonly baseTextures: WebGLTexture[];
  private readonly baseRgbaTextures: WebGLTexture[];
  private readonly layerTextures: WebGLTexture[];
  private readonly layerRgbaTextures: WebGLTexture[];
  private readonly shapes: Array<string | null> = Array(11).fill(null);
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
  private readonly lookTextures = new WeakMap<ParsedCubeLut, WebGLTexture>();
  private readonly ownedLookTextures = new Set<WebGLTexture>();
  private disposed = false;
  private secondary = false;
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
    this.baseProgram = createProgram(gl, BASE_FRAGMENT);
    this.layerProgram = createProgram(gl, LAYER_FRAGMENT);
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
      this.baseProgram,
      this.layerProgram,
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
    gl.useProgram(this.baseProgram);
    ['y0', 'u0', 'v0', 'y1', 'u1', 'v1', 'rgba0', 'rgba1'].forEach((n, i) =>
      gl.uniform1i(uniform(gl, this.baseProgram, n), i),
    );
    this.bind(BASE_RGBA_UNITS[0], this.baseRgbaTextures[0]!);
    this.bind(BASE_RGBA_UNITS[1], this.baseRgbaTextures[1]!);
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
      ['lrgba', LAYER_RGBA_UNIT],
      ['maskRgba', MASK_RGBA_UNIT],
    ].forEach(([n, u]) =>
      gl.uniform1i(uniform(gl, this.layerProgram, n as string), u as number),
    );
    this.bind(4, this.layerRgbaTextures[0]!);
    this.bind(5, this.layerTextures[3]!);
    this.bind(LAYER_RGBA_UNIT, this.layerRgbaTextures[0]!);
    this.bind(MASK_RGBA_UNIT, this.layerRgbaTextures[1]!);
    gl.useProgram(this.copyProgram);
    gl.uniform1i(uniform(gl, this.copyProgram, 'source'), 0);
    gl.useProgram(this.lookProgram);
    gl.uniform1i(uniform(gl, this.lookProgram, 'source'), 0);
    gl.uniform1i(uniform(gl, this.lookProgram, 'lut'), LUT_UNIT);
  }
  private bind(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
  }
  private bind3d(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_3D, texture);
  }

  private lookTexture(lut: ParsedCubeLut): WebGLTexture {
    const cached = this.lookTextures.get(lut);
    if (cached) return cached;
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('WebGL2 could not allocate a 3D LUT texture');
    const gl = this.gl;
    this.bind3d(LUT_UNIT, texture);
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
    if (this.directUploadDisabled)
      this.failDirectUpload('direct upload is disabled for this session');
    if (frame.format !== null && frame.format !== 'NV12' && frame.format !== 'I420')
      this.failDirectUpload(`unsupported VideoFrame format: ${String(frame.format)}`);
    const width = frame.displayWidth;
    const height = frame.displayHeight;
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
      gl.uniform2f(uniforms.sourceSize, width, height);
    }
    return { width, height };
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
    frames: readonly (NativeYuvFrame | VideoFrame)[],
    plan: EvaluationPlan,
    output: EvaluationPlan['output'],
  ): number {
    const gl = this.gl;
    gl.useProgram(this.baseProgram);
    gl.uniform2f(this.baseOutput, output.width, output.height);
    const started = performance.now();
    frames.forEach((frame, index) => {
      if (isVideoFrame(frame)) {
        this.uploadVideoFrameTexture(
          this.baseRgbaTextures[index]!,
          BASE_RGBA_UNITS[index]!,
          frame,
          this.cutUniforms[index],
        );
      } else {
        this.uploadYuv(
          frame,
          this.baseTextures.slice(index * 3, index * 3 + 3),
          index * 3,
          index * 3,
          this.cutUniforms[index],
        );
      }
    });
    if (frames.length === 1 && !this.secondary) {
      const frame = frames[0]!;
      if (isVideoFrame(frame)) {
        this.bind(BASE_RGBA_UNITS[1], this.baseRgbaTextures[0]!);
        this.gl.uniform1i(this.cutUniforms[1]!.format, 2);
        this.gl.uniform2f(
          this.cutUniforms[1]!.sourceSize,
          frame.displayWidth,
          frame.displayHeight,
        );
      } else {
        this.uploadYuv(
          frame,
          this.baseTextures.slice(3, 6),
          3,
          3,
          this.cutUniforms[1],
        );
      }
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
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target);
    this.gl.useProgram(this.baseProgram);
    this.gl.uniform1i(
      this.transitionType,
      TRANSITION_CODES[plan.transition?.type ?? 'hard-cut'],
    );
    this.gl.uniform1f(this.transitionProgress, plan.transition?.progress ?? 0);
  }

  async compose(
    base: readonly (NativeYuvFrame | VideoFrame)[],
    layers: readonly {
      color: NativeYuvFrame | StillImageBitmap | VideoFrame;
      mask?: NativeYuvFrame | VideoFrame | null;
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
    const hasDirectInput = base.some(isVideoFrame) || layers.some(input =>
      isVideoFrame(input.color) || Boolean(input.mask && isVideoFrame(input.mask)));
    if (hasDirectInput && this.directUploadDisabled)
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
    if (layers.length === 0 && !hasLook) {
      this.configureBaseDraw(plan, null);
      draw();
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
    if (base.length > 0) {
      this.configureBaseDraw(plan, this.fbos[0]!);
      draw();
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
      } else {
        width = color.width;
        height = color.height;
        this.uploadYuv(color, this.layerTextures.slice(0, 3), 1, 6);
        gl.uniform1i(kindLoc, 0);
        gl.uniform1i(formatLoc, color.format === 'NV12' ? 1 : 0);
      }
      if (input.mask) {
        if (isVideoFrame(input.mask)) {
          this.uploadVideoFrameTexture(
            this.layerRgbaTextures[1]!,
            MASK_RGBA_UNIT,
            input.mask,
          );
          gl.uniform1i(maskFormatLoc, 2);
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
        }
        gl.uniform1i(hasMaskLoc, 1);
      } else {
        gl.uniform1i(hasMaskLoc, 0);
        gl.uniform1i(maskFormatLoc, 0);
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
    // Unit 0 is also baseProgram.y0. Do not leave an FBO attachment there: the next direct-upload
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
      ...this.ownedImageTextures,
      ...this.ownedLookTextures,
    ])
      this.gl.deleteTexture(t);
    for (const f of this.fbos) this.gl.deleteFramebuffer(f);
    this.gl.deleteBuffer(this.vertices);
    this.gl.deleteProgram(this.baseProgram);
    this.gl.deleteProgram(this.layerProgram);
    this.gl.deleteProgram(this.copyProgram);
    this.gl.deleteProgram(this.lookProgram);
  }
}
