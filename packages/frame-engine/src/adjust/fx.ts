export interface VignetteFxParams {
  amount: number;
  midpoint: number;
  roundness: number;
  feather: number;
}

export interface BlurFxParams { px: number }
export interface GrainFxParams { amount: number; size: number }
export interface SharpenFxParams { amount: number }
export interface GlowFxParams { intensity: number; radius: number; threshold: number; warmth: number }
export interface ClarityFxParams { amount: number; radius: number }
export interface DehazeFxParams { amount: number }
export interface DenoiseFxParams { amount: number }
export interface MotionBlurFxParams { px: number; angle: number }

export type ResolvedAdjustFx =
  | ({ id: 'vignette' } & VignetteFxParams)
  | ({ id: 'blur' } & BlurFxParams)
  | ({ id: 'grain' } & GrainFxParams)
  | ({ id: 'sharpen' } & SharpenFxParams)
  | ({ id: 'glow' } & GlowFxParams)
  | ({ id: 'clarity' } & ClarityFxParams)
  | ({ id: 'dehaze' } & DehazeFxParams)
  | ({ id: 'denoise' } & DenoiseFxParams)
  | ({ id: 'motion_blur' } & MotionBlurFxParams);

function parameter(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

/**
 * Preserve application order and keep the first occurrence of each supported id.
 * Diagnostics are returned through the optional warnings array; no console/global state is used.
 * Disabled sections bypass normalization. Invalid declarations remain errors in authoring validators.
 */
export function normalizeAdjustFx(
  fx: unknown,
  sections?: { fx?: boolean } | null,
  warnings: string[] = []
): ResolvedAdjustFx[] {
  if (sections?.fx === false || fx == null) return [];
  if (!Array.isArray(fx)) {
    warnings.push('adjust.fx.structure: expected an array');
    return [];
  }
  if (fx.length > 8) warnings.push('adjust.fx.max-items: only the first 8 entries are considered');
  const resolved: ResolvedAdjustFx[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of fx.slice(0, 8).entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`adjust.fx[${index}]: expected an effect object`);
      continue;
    }
    const value = entry as Record<string, unknown>;
    const id = value.id;
    if (id !== 'vignette' && id !== 'blur' && id !== 'grain' && id !== 'sharpen'
      && id !== 'glow' && id !== 'clarity' && id !== 'dehaze' && id !== 'denoise' && id !== 'motion_blur') {
      warnings.push(`adjust.fx[${index}].id: unknown effect id "${String(id)}"; ignored`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`adjust.fx.duplicate-id: ${id} at index ${index}; ignored`);
      continue;
    }
    seen.add(id);
    switch (id) {
      case 'vignette':
        resolved.push({ id,
          amount: parameter(value.amount, 0.5, -1, 1),
          midpoint: parameter(value.midpoint, 0.5, 0, 1),
          roundness: parameter(value.roundness, 0, -1, 1),
          feather: parameter(value.feather, 0.5, 0, 1),
        });
        break;
      case 'blur':
        resolved.push({ id, px: parameter(value.px, 8, 0, 50) });
        break;
      case 'grain':
        resolved.push({ id, amount: parameter(value.amount, 0.3, 0, 1), size: parameter(value.size, 1, 0.5, 4) });
        break;
      case 'sharpen':
        resolved.push({ id, amount: parameter(value.amount, 0.5, 0, 1) });
        break;
      case 'glow':
        resolved.push({ id, intensity: parameter(value.intensity, 0.5, 0, 1),
          radius: parameter(value.radius, 20, 0, 100), threshold: parameter(value.threshold, 0.7, 0, 1),
          warmth: parameter(value.warmth, 0, -1, 1) });
        break;
      case 'clarity':
        resolved.push({ id, amount: parameter(value.amount, 0.3, -1, 1), radius: parameter(value.radius, 10, 1, 50) });
        break;
      case 'dehaze':
        resolved.push({ id, amount: parameter(value.amount, 0.3, -1, 1) });
        break;
      case 'denoise':
        resolved.push({ id, amount: parameter(value.amount, 0.3, 0, 1) });
        break;
      case 'motion_blur':
        resolved.push({ id, px: parameter(value.px, 10, 0, 100), angle: parameter(value.angle, 0, -180, 180) });
        break;
    }
  }
  return resolved;
}

/** Empty or entirely zero-strength effects leave pixels unchanged. */
export function isAdjustFxIdentity(fx: unknown): boolean {
  return normalizeAdjustFx(fx).every(effect => effect.id === 'blur' || effect.id === 'motion_blur'
    ? effect.px === 0 : effect.id === 'glow' ? effect.intensity === 0 : effect.amount === 0);
}
