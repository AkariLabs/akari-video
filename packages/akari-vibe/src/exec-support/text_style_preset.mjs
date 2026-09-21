import { presets } from '../v2/telop.mjs';
import { roleKey } from '../v2/telop.mjs';
import { textPosition } from '../ops/_helpers.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { TEXT_SECONDS } from '../ops/_helpers.mjs';
import { positionTransform } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { SCALE_STEP } from '../ops/_helpers.mjs';
export function insertTemplateText(env, d) {
    const fail = reason => env.log.push(`add_text template → 未適用（${reason}）`);
    const declaration = presets[d.w12_template];
    if (!declaration) return fail('指定テンプレがカタログにない／未指定');
    if (!d.newText) return fail('入れる本文が選ばれていない');
    const source = { kind: 'telop', preset: d.w12_template, params: Object.fromEntries(declaration.variables.map(v => [v.key, v.default])) };
    const textKey = roleKey({ source }, 'text');
    if (!textKey) return fail('テンプレのtext role宣言がない');
    source.params[textKey] = d.newText;
    const edit = structuredClone(env.edit);
    let track = edit.tracks.find(t => t.lane === 'visual' && t.items?.some(i => i.source.kind === 'telop'));
    if (!track) {
        let n = 1; while (edit.tracks.some(t => t.id === `w12-telops-${n}`)) n++;
        track = { id: `w12-telops-${n}`, lane: 'visual', items: [] }; edit.tracks.push(track);
    }
    let n = 1; while (env.editStore.locate(edit, `w12-text-${n}`)) n++;
    const id = `w12-text-${n}`, { pos } = textPosition(d, env.ctx, env.context, env.persons);
    env.editStore.insertItem(edit, track.id, { id, source, at: secondsToFrames(edit, env.playheadT),
        duration: secondsToFrames(edit, TEXT_SECONDS), transform: positionTransform(edit, pos) });
    writeEdit(env, edit); env.selection = `item:${id}`;
    env.log.push(`text_style_preset insert ${id} ${d.w12_template} 「${d.newText}」`);
    return;
}
