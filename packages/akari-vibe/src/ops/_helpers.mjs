import { editStore, cutIndexAt } from '../edit-store.mjs';
export const SCALE_STEP = [1.1, 1.25, 1.5];
export const MOVE_STEP = [0.5, 1, 2];
export const GRID = { top_left: [0.18, 0.15], top: [0.5, 0.15], top_right: [0.82, 0.15], left: [0.18, 0.5], center: [0.5, 0.5], right: [0.82, 0.5], bottom_left: [0.18, 0.85], bottom: [0.5, 0.85], bottom_right: [0.82, 0.85] };
export const DEFAULT_TEXT_STYLE = { color: '#ffffff', sizePx: 72, fontWeight: 800, textAnchor: 'mc', stroke: { color: '#000000', widthPx: 8 } };
export const TEXT_SECONDS = 3;
const clamp01 = (v, pad = 0.06) => Math.max(pad, Math.min(1 - pad, v));
export const parseCaptionList = (captionsSource) => (captionsSource ? editStore.parseCaptions(captionsSource).captions : []);
// 文字を置く場所: 人を基準（上下左右・重ねる）→ クリックした場所 → 9 分割 → 既定（下の中央）
export function textPosition(d, ctx, context, persons) {
    const p = persons.find((x) => x.id === d.text_anchor);
    if (p) {
        const [x, y, w, h] = p.box, cx = x + w / 2, cy = y + h / 2 + 0.08; // モック映像は人物を少し下げて描いている
        const side = d.text_side && d.text_side !== 'none' ? d.text_side : 'below';
        const at = { above: [cx, y - 0.02], below: [cx, y + h + 0.1], left: [x - 0.14, cy], right: [x + w + 0.14, cy], over: [cx, cy] }[side];
        return { pos: [clamp01(at[0], 0.12), clamp01(at[1])], why: `${p.label}の${{ above: '上', below: '下', left: '左', right: '右', over: 'ところ' }[side]}` };
    }
    if (d.position === 'pointer' && ctx.pointer) return { pos: ctx.pointer, why: 'クリックした場所' };
    if (GRID[d.position]) return { pos: GRID[d.position], why: d.position };
    return { pos: [0.5, 0.85], why: '既定（下の中央）' };
}
export const pxVar = (v) => Number(String(v ?? '0').replace('px', '')) || 0;


export function targets(env, d) {
    const { captions, segments, playheadT } = env;
    const capMatch = d.target?.match(/^caption_(.+)$/);
    const cap = capMatch ? captions.find((c) => c.id === capMatch[1].replace(/_/g, '-')) : null;
    const level = Math.max(0, Math.min(2, Math.round(d.amount ?? 1)));
    const cutTarget = d.target?.match(/^cut_(\d+)$/);
    const hereIdx = cutIndexAt(segments, playheadT);
    const item = d.target?.match(/^(item)_(.+)$/);
    const itemId = item ? item[2].replace(/_/g, '-') : null;
    const rewriteCaption = (c, patch) => { env.captionsSource = env.editStore.insertCaptionLine(env.editStore.removeCaptionLine(env.captionsSource, c.id), { ...c, ...patch, textStyle: { ...c.textStyle, ...(patch.textStyle ?? {}) } }); };
    return { cap, level, cutTarget, hereIdx, item, itemId, rewriteCaption };
}
