import { targetItem } from '../ops/_knobs.mjs';
import { unapplied } from '../exec-support/item_duration_rotate_duration.mjs';
import { view } from '../v2/model.mjs';
import trimCut from './trim_cut.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { levelOf } from '../exec-support/item_duration_rotate_duration.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'item_duration', apply(env, d) {
        const item = targetItem(env, d.target);
        if (!item) { unapplied(env, d, '対象itemがない'); return; }
        const model = view(env.edit);
        const isCut = model.segments.some(s => s.itemId === item.id);
        if (isCut && ['head', 'tail'].includes(d.trim_edge)) return trimCut.apply(env, d);
        if (item.anchor) { unapplied(env, d, '字幕アンカーの表示尺は参照範囲の更新が必要'); return; }
        let duration;
        if (d.duration_mode === 'until') {
            // applyDecision changes env.playheadT for seek, but keeps the input ctx.
            const spokenPlayheadT = env.ctx?.playheadT ?? env.playheadT;
            const end = d.duration_end === 'cut_end'
                ? model.segments.find(s => spokenPlayheadT >= s.at && spokenPlayheadT < s.end)?.end
                : d.duration_end === 'video_end' ? model.segments.at(-1)?.end : undefined;
            if (end == null) { unapplied(env, d, '指定終端に対応する区間がない'); return; }
            const location = model.locations.find(l => l.item.id === item.id);
            duration = end - framesToSeconds(env.edit, env.editStore.absoluteAt(location));
        } else {
            if (!['extend', 'shorten', 'set'].includes(d.duration_mode)) { unapplied(env, d, '尺の変更方法が不明'); return; }
            if (!['none', 'seconds'].includes(d.duration_end)) { unapplied(env, d, '尺の変更方法と終点が矛盾'); return; }
            if ((d.duration_end === 'seconds' || d.duration_mode === 'set') && !Number.isFinite(d.seconds)) { unapplied(env, d, '秒数を抽出できない'); return; }
            const delta = d.seconds ?? [0.5, 1, 2][levelOf(d)];
            if (!Number.isFinite(delta) || delta < 0) { unapplied(env, d, '秒数が不正'); return; }
            duration = d.duration_mode === 'set' ? delta : framesToSeconds(env.edit, item.duration) + delta * (d.duration_mode === 'shorten' ? -1 : 1);
        }
        if (!Number.isFinite(duration) || secondsToFrames(env.edit, duration) < 1) { unapplied(env, d, '表示尺が1フレーム未満になる'); return; }
        if (isCut) {
            const delta = duration - framesToSeconds(env.edit, item.duration);
            if (Math.abs(delta) < 1e-12) { env.log.push('item_duration → 長さ変更なし'); return; }
            return trimCut.apply(env, { ...d, trim_edge: 'tail', trim_dir: delta > 0 ? 'extend' : 'shorten',
                seconds: Math.abs(delta) * (item.source.speed ?? 1) });
        }
        if (knobs(env, item, { duration })) env.log.push(`item_duration ${item.id} → ${secondsToFrames(env.edit, duration)} frames`);
    } };
