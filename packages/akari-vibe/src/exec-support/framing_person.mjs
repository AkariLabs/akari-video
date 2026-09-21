import { targetItem } from '../ops/_knobs.mjs';
import { view } from '../v2/model.mjs';
import { knobs } from '../ops/_knobs.mjs';
export const MAX_SCALE = 3;
export const PERSON_HEIGHT = 0.85;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function centerAnchor(text = '') {
    if (!/(真ん中|まんなか|中央|中心)/u.test(text)) return null;
    return /顔/u.test(text) ? 'face' : 'body';
}
