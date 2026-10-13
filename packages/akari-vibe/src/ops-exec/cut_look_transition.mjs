import { guardedApply, unapplied, visualTarget, vocabulary } from '../exec-support/cut_look_transition.mjs';
import { view } from '../v2/model.mjs';
import { editStore } from '../edit-store.mjs';
import { patchItem, writeEdit } from '../ops/_knobs.mjs';

const EPSILON = 0.000001;

function captionPolicyPresent(env) {
    if (typeof env.captionsSource !== 'string') return false;
    try {
        const root = JSON.parse(env.captionsSource);
        return !!root && !Array.isArray(root) && root.display_policy !== undefined;
    } catch { return false; }
}

function plannedAt(clips, earlierId, duration, align, fill, fps) {
    const candidate = clips.map(clip => clip.id === earlierId ? {
        ...clip,
        ...(fill ? {} : { tailRoomSeconds: clip.tailRoomSeconds ?? 0 }),
        transitionOut: { declaredSeconds: duration, align, fill }
    } : fill ? clip : { ...clip, tailRoomSeconds: Number.POSITIVE_INFINITY });
    const plans = editStore.planTrackTransitions(candidate, { fps, tailRoom: fill ? 'ignore' : 'limit' });
    const plan = plans.find(entry => entry.earlierId === earlierId);
    return { plan, plans };
}

function neighborChanges(before, after, earlierId) {
    return after.filter(plan => plan.earlierId !== earlierId && (
        !before.some(previous => previous.earlierId === plan.earlierId && previous.laterId === plan.laterId
            && Math.abs(previous.effectiveSeconds - plan.effectiveSeconds) <= EPSILON)));
}

export default { id: 'cut_look_transition', apply(env, d) {
    return guardedApply(env, d.op, () => {
        if (d.allow_freeze !== undefined && typeof d.allow_freeze !== 'boolean')
            throw new Error('allow_freeze は真偽値で指定してください');
        if (d.cutLookTransitionSeconds !== undefined
            && (!Number.isFinite(d.cutLookTransitionSeconds) || d.cutLookTransitionSeconds <= 0))
            throw new Error('つなぎの秒数が正でない');
        const { item, location } = visualTarget(env, d, true);
        if (location.parent) throw new Error('グループ内のつなぎは未対応');
        if (!vocabulary.some(v => v.id === d.transition_type)
            && d.transition_type !== item.source.transition_out?.type) throw new Error('つなぎの種類が未指定・未知');
        if (d.align !== undefined && !editStore.isTransitionAlign(d.align)) throw new Error('つなぎの位置が不正');

        const model = view(env.edit), segment = model.segments.find(entry => entry.itemId === item.id);
        const legacy = editStore.projectLegacyEdit(model.internal);
        if (!segment || typeof editStore.unsupportedTrackTransitionTarget !== 'function')
            throw new Error('トラック互換性の受け口が未確認');
        if (editStore.unsupportedTrackTransitionTarget(legacy.cuts, legacy.timeline?.tracks, segment.index) !== undefined)
            throw new Error('現在のトラック構成ではつなぎを表現できない');
        const next = location.track.items.filter(entry => entry.at > item.at).sort((a, b) => a.at - b.at)[0];
        if (!next || next.source.kind !== 'media' || next.at !== item.at + item.duration)
            throw new Error('直後に接する映像カットが無い');

        const existing = item.source.transition_out;
        const duration = d.cutLookTransitionSeconds ?? existing?.duration ?? 0.5;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('つなぎの秒数が正でない');
        const typeOnly = !!existing && d.align === undefined && d.allow_freeze !== true
            && (d.cutLookTransitionSeconds === undefined || d.cutLookTransitionSeconds === existing.duration);

        const cuts = legacy.cuts.map((cut, index) => ({ ...cut,
            transitionOut: model.segments[index]?.raw?.source?.transition_out ?? cut.transitionOut }));
        const paths = new Map((env.edit.sources ?? []).map(source => [source.id, source.path]));
        const tracks = editStore.transitionPlanClipsFromCuts(cuts, { fps: env.edit.output.fps,
            resolve: (cut, index) => ({
                stillImage: editStore.isStillImageSourcePath(paths.get(cut.src)
                    ?? model.segments[index]?.raw?.source?.path
                    ?? (cut.src === undefined && env.edit.sources?.length === 1
                        ? env.edit.sources[0].path : undefined)),
                freezeSeconds: Number(model.segments[index]?.raw?.source?.freeze?.duration_sec) || 0
            }) });
        const earlierId = String(segment.index);
        const track = tracks.find(candidate => candidate.clips.some(clip => clip.id === earlierId));
        if (!track) throw new Error('つなぎの計画を作れない');
        const fps = env.edit.output.fps;
        const before = editStore.planTrackTransitions(track.clips, { fps, tailRoom: 'ignore' });
        if (typeOnly) {
            patchItem(env, item.id, { source: { transition_out: { ...existing, type: d.transition_type } } });
            env.log.push(`transition ${item.id} → ${d.transition_type} ${duration}秒`);
            const effective = before.some(plan => plan.earlierId === earlierId && plan.state !== 'none');
            return captionPolicyPresent(env) && effective
                ? { applied: true, captionDisplayPolicyConflict: true } : undefined;
        }
        let align, needsFill = false, plan, changes = [];
        if (!existing && d.align === undefined) {
            const choice = editStore.chooseTransitionAlign(track.clips, earlierId, duration,
                { fps, tailRoom: 'ignore', allowFill: true });
            if (!choice) throw new Error('つなぎの計画を作れない');
            ({ align, plan, neighborChanges: changes } = choice);
            needsFill = choice.needsFill;
        } else {
            align = d.align ?? editStore.readTransitionAlign(existing?.align);
            if (d.align !== undefined || d.allow_freeze === true) {
                const plain = plannedAt(track.clips, earlierId, duration, align, false, fps);
                const filled = plannedAt(track.clips, earlierId, duration, align, true, fps);
                needsFill = (filled.plan?.effectiveSeconds ?? 0) - (plain.plan?.effectiveSeconds ?? 0)
                    >= 1 / fps - EPSILON;
                ({ plan } = needsFill ? filled : plain);
                changes = neighborChanges(before, (needsFill ? filled : plain).plans, earlierId);
            } else {
                const currentClips = track.clips.map(clip => clip.id === earlierId ? { ...clip,
                    transitionOut: { declaredSeconds: duration, align, fill: existing?.fill === 'freeze' } } : clip);
                const current = { plan: editStore.planTrackTransitions(currentClips,
                    { fps, tailRoom: 'ignore' }).find(entry => entry.earlierId === earlierId) };
                ({ plan } = current);
            }
        }
        if (!plan || plan.state === 'none') {
            const structural = plannedAt(track.clips, earlierId, duration, align, true, fps).plan;
            if (!structural || structural.state === 'none') throw new Error('つなぎが 1 コマ以上効かない');
            if (!plan) plan = structural;
        }
        const captionDisplayPolicyConflict = captionPolicyPresent(env) && plan.state !== 'none';
        if (needsFill && !d.allow_freeze) {
            unapplied(env, d.op, '止め絵が必要です。allow_freeze を true にすると書けます');
            return {
                applied: false, reason: 'needs-freeze', align, declaredSeconds: duration,
                freezeIncomingSeconds: plan.freezeIncomingSeconds,
                freezeOutgoingSeconds: plan.freezeOutgoingSeconds ?? 0,
                freezeOutgoingUnknown: !!plan.freezeOutgoingUnknown,
                neighborChanges: changes,
                ...(captionDisplayPolicyConflict ? { captionDisplayPolicyConflict: true } : {})
            };
        }

        const transition = { ...existing, type: d.transition_type, duration };
        if (d.align !== undefined || !existing) {
            if (align === 'center') delete transition.align;
            else transition.align = align;
        }
        if (needsFill) transition.fill = 'freeze';
        if (d.align === 'center') {
            const edit = structuredClone(env.edit);
            editStore.locate(edit, item.id).item.source.transition_out = transition;
            writeEdit(env, edit);
        } else patchItem(env, item.id, { source: { transition_out: transition } });
        env.log.push(`transition ${item.id} → ${d.transition_type} ${duration}秒`);
        return captionDisplayPolicyConflict ? { applied: true, captionDisplayPolicyConflict: true } : undefined;
    });
} };
