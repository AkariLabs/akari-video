import { guardedApply } from '../exec-support/cut_look_transition.mjs';
import { visualTarget } from '../exec-support/cut_look_transition.mjs';
import { view } from '../v2/model.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'cut_look_freeze', apply(env, d) {
        guardedApply(env, d.op, () => {
            const { item, location } = visualTarget(env, d, true);
            if (location.parent) throw new Error('グループ内の止め絵の尺延長は未対応');
            if (item.source.freeze) throw new Error('既存の止め絵の置換は未対応');
            const segment = view(env.edit).segments.find(s => s.itemId === item.id);
            if (!segment || !Number.isFinite(env.playheadT) || env.playheadT < segment.at || env.playheadT >= segment.end)
                throw new Error('再生ヘッドが対象カットの外');
            const seconds = d.cutLookFreezeSeconds ?? 2;
            if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('止め絵の秒数が正でない');
            const added = secondsToFrames(env.edit, seconds);
            if (!Number.isSafeInteger(added) || added < 1) throw new Error('止め絵の尺が整数フレームで表せない');
            const end = item.at + item.duration;
            if (location.track.items.some(i => i.id !== item.id && i.at < end && i.at + i.duration > item.at))
                throw new Error('同じトラックでカットが重なっている');
            // Lab-local compound edit: keep source in/out, extend duration, ripple same-track followers.
            // Public computeCutTrackSegments currently omits freeze hold time from segment.end;
            // item.duration is correct, but the existing lab HUD's held tail remains a known limitation.
            // Stage all writes separately so reader rejection cannot leave a partial change in env.
            const staged = { edit: structuredClone(env.edit), source: env.source, log: [] };
            patchItem(staged, item.id, {
                source: { freeze: { at_sec: env.playheadT - segment.at, duration_sec: framesToSeconds(env.edit, added) } },
                duration: item.duration + added,
            });
            for (const follower of location.track.items.filter(i => i.id !== item.id && i.at >= end))
                editStore.updateItem(staged.edit, follower.id, { at: follower.at + added });
            writeEdit(env, staged.edit);
            env.log.push(`freeze ${item.id} → ${env.playheadT - segment.at}秒の絵を${framesToSeconds(env.edit, added)}秒保持（同トラックの後続を移動・別トラックは固定）`);
        });
    } };
