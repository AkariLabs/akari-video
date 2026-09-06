import type { ResolvedAdjustFx } from '../adjust/fx.js';

const FX_STAGES = {
  vignette: ['vignette'], grain: ['grain'], sharpen: ['sharpen'],
  blur: ['gaussian-h', 'gaussian-v'],
  glow: ['bright-pass', 'gaussian-h', 'gaussian-v', 'glow-composite'],
  clarity: ['gaussian-h', 'gaussian-v', 'clarity-composite'],
  dehaze: ['dehaze'], denoise: ['denoise'], motion_blur: ['motion-blur'],
} as const;

type FxStage = (typeof FX_STAGES)[keyof typeof FX_STAGES][number];
interface PlannableFx {
  id: keyof typeof FX_STAGES;
  px?: number;
  amount?: number;
  intensity?: number;
}
export interface FxPass<T = ResolvedAdjustFx> {
  stage: FxStage;
  effect: T;
}

/** Gaussian H/V share arithmetic; composite stages need their own specialization. */
export const FX_PASS_KINDS: Record<FxStage, number> = {
  vignette: 1, 'gaussian-h': 2, 'gaussian-v': 2, grain: 3, sharpen: 4,
  'bright-pass': 5, 'glow-composite': 6, 'clarity-composite': 7,
  dehaze: 8, denoise: 9, 'motion-blur': 10,
};

/** Pure, ordered effect expansion. Prep is separate; zero-strength stages need no draw. */
export function planFxPasses<T extends PlannableFx>(fx: readonly T[] = []): FxPass<T>[] {
  return fx.flatMap(effect => {
    const strength = effect.id === 'blur' || effect.id === 'motion_blur' ? effect.px
      : effect.id === 'glow' ? effect.intensity : effect.amount;
    return strength === 0 ? [] : FX_STAGES[effect.id].map(stage => ({ stage, effect }));
  });
}

export interface FxSize { width: number; height: number }
export interface FxCrop extends FxSize { x: number; y: number }

/** Keep the crop's texel grid until either output bound is reached. */
export function fxWorkingSize(source: FxSize, crop: FxCrop, output: FxSize): FxSize {
  return {
    width: Math.max(1, Math.min(output.width, Math.ceil(source.width * crop.width))),
    height: Math.max(1, Math.min(output.height, Math.ceil(source.height * crop.height))),
  };
}

/** Radius in work texels; H renders the reduced viewport, V expands back to work size. */
export function fxGaussianGeometry(px: number, outputWidth: number, work: FxSize, displayed: FxSize) {
  const radius = px * outputWidth / 1920;
  const rx = radius * work.width / Math.max(displayed.width, 1e-6);
  const ry = radius * work.height / Math.max(displayed.height, 1e-6);
  const levels = Math.max(0, Math.ceil(Math.log2(Math.max(rx, ry) / 16)));
  const divisor = 2 ** levels;
  const reduced = {
    width: Math.max(1, Math.floor(work.width / divisor)),
    height: Math.max(1, Math.floor(work.height / divisor)),
  };
  return { reduced, radiusX: rx * reduced.width / work.width, radiusY: ry * reduced.height / work.height };
}

/** Normalized centre + symmetric pairs, computed once per work radius, never per pixel. */
export function fxGaussianWeights(radius: number): { weights: Float32Array; tapCount: number } {
  const tapCount = Math.min(16, Math.max(0, Math.ceil(radius)));
  const weights = new Float32Array(17);
  weights[0] = 1;
  let sum = 1;
  const sigma = radius / 2;
  for (let tap = 1; tap <= tapCount; tap++) {
    const weight = Math.exp(-0.5 * (tap / sigma) ** 2);
    weights[tap] = weight;
    sum += 2 * weight;
  }
  for (let tap = 0; tap <= tapCount; tap++) weights[tap] = weights[tap]! / sum;
  return { weights, tapCount };
}

// Work textures use a top-left logical UV at the GL bottom-left, consistently through
// prep, every effect and the final sampler. Only the final compositor flips output Y.
export const FX_PASS_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 color;
uniform sampler2D source;
uniform sampler2D original;
uniform vec2 allocationSize;
uniform vec2 inputSize;
uniform vec2 workSize;
uniform vec2 cropSize;
uniform int fxKind;
uniform vec4 params;
uniform vec2 direction;
uniform float gaussianWeights[17];
uniform int tapCount;
uniform uint frameIndex;
vec4 sampleWork(vec2 local) {
  vec2 pixel = clamp(local * inputSize, vec2(0.5), inputSize - 0.5);
  return texture(source, pixel / allocationSize);
}
#if FX_KIND == 3
uint fxHash(uint value) {
  value ^= value >> 16u;
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}
#endif
void main() {
  vec4 src = sampleWork(uv);
  vec3 rgb = src.rgb;
#if FX_KIND == 1
    vec2 local = uv;
    vec2 box = cropSize;
    vec2 delta = abs(local - 0.5) * 2.0;
    float roundness = (params.z + 1.0) * 0.5;
    vec2 aspect = mix(vec2(1.0), box / max(min(box.x, box.y), 0.000001), roundness);
    float distance = mix(max(delta.x, delta.y), length(delta * aspect), roundness);
    float falloff = params.w == 0.0 ? step(params.y, distance)
      : smoothstep(params.y, params.y + params.w, distance);
    rgb = clamp(rgb - vec3(params.x * falloff), 0.0, 1.0);
#elif FX_KIND == 2
    vec3 sum = rgb * gaussianWeights[0];
    // Centre + at most sixteen pairs: 33 taps, a dense separable Gaussian.
    for (int tap = 1; tap <= 16; tap++) {
      if (tap > tapCount) break;
      float weight = gaussianWeights[tap];
      vec2 offset = direction * float(tap);
      sum += (sampleWork(uv - offset).rgb + sampleWork(uv + offset).rgb) * weight;
    }
    rgb = sum;
#elif FX_KIND == 3
    vec2 workPixel = uv * workSize;
    uvec2 cell = uvec2(ivec2(floor(workPixel / params.y))) + uvec2(frameIndex);
    uint bits = fxHash(cell.x ^ fxHash(cell.y));
    float noise = float(bits >> 8u) / 16777215.0 * 2.0 - 1.0;
    rgb = clamp(rgb + vec3(noise * params.x * 0.15), 0.0, 1.0);
#elif FX_KIND == 4
    vec3 sum = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) sum += sampleWork(uv + vec2(x, y) / workSize).rgb;
    }
    rgb = clamp(rgb + params.x * (rgb - sum / 9.0), 0.0, 1.0);
#elif FX_KIND == 5
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb *= step(params.z, luma);
#elif FX_KIND == 6 || FX_KIND == 7
    vec2 pixel = clamp(uv * workSize, vec2(0.5), workSize - 0.5);
    vec4 base = texture(original, pixel / allocationSize);
#if FX_KIND == 6
      vec3 tint = vec3(1.0 + params.w * 0.25, 1.0, 1.0 - params.w * 0.25);
      rgb = clamp(base.rgb + params.x * rgb * tint, 0.0, 1.0);
#else
      rgb = clamp(base.rgb + params.x * (base.rgb - rgb), 0.0, 1.0);
#endif
    src.a = base.a;
#elif FX_KIND == 8
    float dark = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 tap = sampleWork(uv + vec2(x, y) / workSize).rgb;
        dark = min(dark, min(tap.r, min(tap.g, tap.b)));
      }
    }
    // White atmospheric light; cap transmission to keep recovery finite.
    float transmission = max(0.1, 1.0 - 0.95 * abs(params.x) * dark);
    rgb = params.x >= 0.0 ? (rgb - 1.0) / transmission + 1.0
      : rgb * transmission + vec3(1.0 - transmission);
    rgb = clamp(rgb, 0.0, 1.0);
#elif FX_KIND == 9
    float sigma = max(0.0001, params.x * 0.25);
    vec3 sum = vec3(0.0);
    float weightSum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(x, y);
        vec3 tap = sampleWork(uv + offset / workSize).rgb;
        vec3 delta = tap - rgb;
        float weight = exp(-dot(offset, offset) / 8.0 - dot(delta, delta) / (2.0 * sigma * sigma));
        sum += tap * weight;
        weightSum += weight;
      }
    }
    rgb = sum / weightSum;
#elif FX_KIND == 10
    vec3 sum = vec3(0.0);
    // direction is the full output-pixel length converted to crop-local UV.
    for (int tap = -8; tap <= 8; tap++) {
      sum += sampleWork(uv + direction * (float(tap) / 16.0)).rgb;
    }
    rgb = sum / 17.0;
#endif
  color = vec4(rgb, src.a);
}`;
