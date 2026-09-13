import { adapter as h3Adapter } from "./fal-h3-i2v.mjs";
import { adapter as klingAdapter, proAdapter as klingProAdapter } from "./fal-kling-v3-i2v.mjs";
import { adapter as seedanceAdapter } from "./fal-seedance-2-i2v.mjs";
import { adapter as veoAdapter } from "./fal-veo-3.1-flf.mjs";

export {
  AUX_KEYS,
  KNOB_KEYS,
  MAP_KEYS,
  SLOT_KEYS,
  applyMap,
  composeCameraPrompt,
  isEmptySlot,
  ok,
  reject,
  rejectAll,
  resolveRef,
} from "./request-shape.mjs";

export const ADAPTERS = Object.freeze({
  [h3Adapter.id]: h3Adapter,
  [klingAdapter.id]: klingAdapter,
  [klingProAdapter.id]: klingProAdapter,
  [seedanceAdapter.id]: seedanceAdapter,
  [veoAdapter.id]: veoAdapter,
});

export function getAdapter(modelId) {
  return ADAPTERS[modelId];
}
