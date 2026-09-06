export interface VignetteFxParams {
  amount: number;
  midpoint: number;
  roundness: number;
  feather: number;
}

export interface BlurFxParams { px: number }
export interface GrainFxParams { amount: number; size: number }
export interface SharpenFxParams { amount: number }

export type ResolvedAdjustFx =
  | ({ id: 'vignette' } & VignetteFxParams)
  | ({ id: 'blur' } & BlurFxParams)
  | ({ id: 'grain' } & GrainFxParams)
  | ({ id: 'sharpen' } & SharpenFxParams);

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
    if (id !== 'vignette' && id !== 'blur' && id !== 'grain' && id !== 'sharpen') {
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
    }
  }
  return resolved;
}

/** Empty or entirely zero-strength effects leave pixels unchanged. */
export function isAdjustFxIdentity(fx: unknown): boolean {
  return normalizeAdjustFx(fx).every(effect => effect.id === 'blur' ? effect.px === 0 : effect.amount === 0);
}
