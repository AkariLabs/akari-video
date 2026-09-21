import { targetItem } from '../ops/_knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export function mediaTarget(env, d) {
    const item = targetItem(env, d.target);
    if (!item || item.source.kind !== 'media' || !Number.isFinite(item.source.in) ||
        !Number.isFinite(item.source.out) || item.source.out <= item.source.in) {
        env.log.push(`${d.op}: ${d.target} → 未適用（有限の使用区間を持つ media item が必要）`);
        return null;
    }
    if (item.source.freeze || item.anchor) {
        env.log.push(`${d.op}: ${item.id} → 未適用（止め絵・字幕アンカーの尺再計算は未対応）`);
        return null;
    }
    return item;
}
