import presetData from './telop-presets.json' with { type: 'json' };
import { editStore } from '../edit-store.mjs';
export const presets = presetData;
export const roleKey = (item, role) => presets[item.source.preset]?.variables.find(v => v.role === role)?.key;
export const roleValue = (item, role) => item.source.params?.[roleKey(item, role)];
export function telopSource(text) {
    const DEFAULT_PRESET = editStore.DEFAULT_CAPTION_TELOP_PRESET;
    const source = { kind: 'telop', preset: DEFAULT_PRESET, params: Object.fromEntries(presets[DEFAULT_PRESET].variables.map(v => [v.key, v.default])) };
    source.params[roleKey({ source }, 'text')] = text;
    return source;
}
