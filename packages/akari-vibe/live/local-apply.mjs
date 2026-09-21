import { invokeExecutor } from '../src/exec-support/invoke.mjs';
import { execById } from '../src/ops-exec/index.mjs';
import { editStore } from '../src/edit-store.mjs';
import { view } from '../src/v2/model.mjs';
import { parseCaptionList } from '../src/ops/_helpers.mjs';
export { parseCaptionList } from '../src/ops/_helpers.mjs';
import { timeOfTarget, placeOf } from '../src/target-geometry.mjs';
export function applyDecision({ source, edit, ctx, segments, context, captionsSource = null, persons = [],
    companion = false, sendCommand, sendAnnotate, reviewSource = null }, d, operationsById = execById) {
    const env = { source, captionsSource, edit, ctx, segments, context, persons,
        captions: parseCaptionList(captionsSource), playheadT: ctx.playheadT ?? 0, log: [], editStore,
        companion, sendCommand, sendAnnotate, reviewSource, pendingEffects: [] };
    const { captions, log } = env;
    if (d.seek_to && d.seek_to !== 'none') {
        const cut = d.seek_to.match(/^cut_(\d+)$/);
        const seg = context.transcript.find((g) => g.id === d.seek_to);
        if (cut) env.playheadT = segments.find(s => s.index + 1 === Number(cut[1]))?.at ?? env.playheadT;
        else if (seg) env.playheadT = seg.start;
        else if (d.seek_to === 'the_target') env.playheadT = timeOfTarget(placeOf(d), { edit, segments, captions }) ?? env.playheadT;
        else if (d.seek_to === 'time_spoken' && d.seconds != null) env.playheadT = d.seconds;
        log.push(`seek → ${env.playheadT}秒（${d.seek_to === 'the_target' ? placeOf(d) : d.seek_to}）`);
    }


    const op = operationsById.get(d.op);
    if (op) {
        if (d.targets) {
            for (const target of d.targets) {
                invokeExecutor(op, env, { ...d, target });
                // The source is authoritative, including operations that only update source.
                env.edit = JSON.parse(env.source);
                env.segments = view(env.edit).segments;
                env.captions = parseCaptionList(env.captionsSource);
            }
        } else invokeExecutor(op, env, d);
    }
    else if (d.op && d.op !== 'none') log.push(`${d.op}: 未登録の操作 → 未適用`);
    const total = view(JSON.parse(env.source)).segments.at(-1)?.end ?? 0;
    editStore.readEditV2(JSON.parse(env.source));
    return { lastCandidates: env.lastCandidates, selection: env.selection, source: env.source, captionsSource: env.captionsSource,
        playheadT: Math.max(0, Math.min(env.playheadT, Math.max(0, total - 0.01))), log,
        reviewSource: env.reviewSource, pendingEffects: env.pendingEffects,
        changed: env.source !== source || env.captionsSource !== captionsSource };
}
