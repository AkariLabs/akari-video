import { targets } from '../ops/_helpers.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { clampNudgedTransform } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
export const REPEATABLE = new Set(['move_pos', 'scale', 'item_rotate']);
export const DEFAULT_ITEM_BOX = [.2, .78, .6, .14];
export const failed = (env, reason) => env.log.push(`repeat → 未適用（${reason}）`);
export function applyRepeatedTimes(env, d) {
    if (d.times == null) return false;
    const times = Number(d.times);
    if (!Number.isInteger(times) || times < 1 || times > 10) { failed(env, '回数が不正'); return true; }
    const entry = Array.isArray(env.ctx?.history) ? env.ctx.history[0] : null;
    if (!entry) { failed(env, '直前の操作履歴がない'); return true; }
    if (!REPEATABLE.has(entry.op)) { failed(env, '直前の操作が相対移動・拡縮・回転ではない'); return true; }
    const target = entry.target;
    const { cap, rewriteCaption } = targets(env, { target });
    if (cap) {
        if (entry.op === 'move_pos') {
            const current = cap.textStyle?.position ?? { x: .5, y: .5 };
            const before = entry.before?.textStyle?.position;
            if (!before || !Number.isFinite(before.x) || !Number.isFinite(before.y)) { failed(env, '直前の移動量を復元できない'); return true; }
            const position = {
                x: Math.max(0, Math.min(1, current.x + (current.x - before.x) * times)),
                y: Math.max(0, Math.min(1, current.y + (current.y - before.y) * times)),
            };
            rewriteCaption(cap, { textStyle: { position } });
            env.log.push(`repeat move_pos ${cap.id} → ${times}回分`);
            return true;
        }
        if (entry.op === 'scale') {
            const current = cap.textStyle?.sizePx ?? 72;
            const before = entry.before?.textStyle?.sizePx;
            const factor = current / before;
            const sizePx = Math.round(current * factor ** times);
            if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(sizePx) || sizePx <= 0 || sizePx > 72 * 20) {
                failed(env, '結果の倍率が0以下または20倍超'); return true;
            }
            rewriteCaption(cap, { textStyle: { sizePx } });
            env.log.push(`repeat scale ${cap.id} → ${times}回分`);
            return true;
        }
        failed(env, '字幕行の回転は未対応');
        return true;
    }
    const item = targetItem(env, target);
    if (!item) { failed(env, '直前の対象itemがない'); return true; }
    if (entry.op === 'move_pos') {
        const current = { x: item.transform?.x ?? 0, y: item.transform?.y ?? 0 };
        const before = entry.before?.transform;
        if (!before || !Number.isFinite(before.x) || !Number.isFinite(before.y)) { failed(env, '直前の移動量を復元できない'); return true; }
        const next = { x: current.x + (current.x - before.x) * times, y: current.y + (current.y - before.y) * times };
        const isCut = env.segments.some(segment => segment.itemId === item.id);
        const box = env.context.layout?.[`item:${item.id}`]?.box ?? (isCut ? [0, 0, 1, 1] : DEFAULT_ITEM_BOX);
        const bounded = clampNudgedTransform(env.edit, item, next, box);
        if (knobs(env, item, { transform: bounded.transform })) {
            env.log.push(`repeat move_pos ${item.id} → ${times}回分${bounded.stopped ? '（画面端で停止）' : ''}`);
        }
        return true;
    }
    if (entry.op === 'scale') {
        const current = item.transform?.scale ?? 1;
        const before = entry.before?.transform?.scale;
        const factor = current / before;
        const scale = Number((current * factor ** times).toFixed(4));
        if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(scale) || scale <= 0 || scale > 20) {
            failed(env, '結果の倍率が0以下または20倍超'); return true;
        }
        if (knobs(env, item, { transform: { scale } })) env.log.push(`repeat scale ${item.id} → ${scale}（${times}回分）`);
        return true;
    }
    const current = item.transform?.rotate ?? 0;
    const before = entry.before?.transform?.rotate;
    if (!Number.isFinite(before)) { failed(env, '直前の回転量を復元できない'); return true; }
    const rotate = current + (current - before) * times;
    if (!Number.isFinite(rotate)) { failed(env, '回転量が不正'); return true; }
    if (knobs(env, item, { transform: { rotate } })) env.log.push(`repeat item_rotate ${item.id} → ${rotate}度（${times}回分）`);
    return true;
}
