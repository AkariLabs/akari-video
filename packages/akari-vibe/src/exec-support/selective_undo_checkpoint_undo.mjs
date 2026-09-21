import { itemForKey } from '../v2/model.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export const PREFIX = 'selective_undo_checkpoint_';
export const ENTRY = `${PREFIX}entry`;
export const POINT = `${PREFIX}point`;
export const entries = (ctx, key) => Array.isArray(ctx?.[key]) ? ctx[key] : [];
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function partialBefore(current, before) {
    const result = record(current) ? structuredClone(current) : {};
    for (const [key, value] of Object.entries(before)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('不正な before キー');
        result[key] = record(value) ? partialBefore(result[key], value) : structuredClone(value);
    }
    return result;
}
