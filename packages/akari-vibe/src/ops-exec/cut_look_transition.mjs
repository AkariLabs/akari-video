import { guardedApply } from '../exec-support/cut_look_transition.mjs';
import { visualTarget } from '../exec-support/cut_look_transition.mjs';
import { vocabulary } from '../exec-support/cut_look_transition.mjs';
import { view } from '../v2/model.mjs';
import { editStore } from '../edit-store.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'cut_look_transition', apply(env, d) {
        guardedApply(env, d.op, () => {
            const { item, location } = visualTarget(env, d, true);
            if (location.parent) throw new Error('グループ内のつなぎは未対応');
            if (!vocabulary.some(v => v.id === d.transition_type)) throw new Error('つなぎの種類が未指定・未知');
            const model = view(env.edit), segment = model.segments.find(s => s.itemId === item.id);
            const legacy = editStore.projectLegacyEdit(model.internal);
            if (!segment || typeof editStore.unsupportedTrackTransitionTarget !== 'function') throw new Error('トラック互換性の受け口が未確認');
            if (editStore.unsupportedTrackTransitionTarget(legacy.cuts, legacy.timeline?.tracks, segment.index) !== undefined)
                throw new Error('現在のトラック構成ではつなぎを表現できない');
            const next = location.track.items.filter(i => i.at > item.at).sort((a, b) => a.at - b.at)[0];
            if (!next || next.source.kind !== 'media' || next.at !== item.at + item.duration)
                throw new Error('直後に接する映像カットが無い');
            // transitionOut.duration is seconds (unlike item.duration).
            const duration = d.cutLookTransitionSeconds ?? item.source.transition_out?.duration ?? 0.5;
            if (!Number.isFinite(duration) || duration <= 0 || duration >= Math.min(item.duration, next.duration) / env.edit.output.fps)
                throw new Error('つなぎの秒数が正でない、または隣接カット尺以上');
            patchItem(env, item.id, { source: { transition_out: { type: d.transition_type, duration } } });
            env.log.push(`transition ${item.id} → ${d.transition_type} ${duration}秒`);
        });
    } };
