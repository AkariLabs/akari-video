import { targetItem } from '../ops/_knobs.mjs';
import { roleKey } from '../v2/telop.mjs';
import { presets } from '../v2/telop.mjs';
import { SCALE_STEP } from '../ops/_helpers.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'text_style_preset', apply(env, d) {
        const fail = reason => env.log.push(`text_style_preset ${d.w12_change ?? 'none'} → 未適用（${reason}）`);
        const item = targetItem(env, d.target);
        if (!item || item.source.kind !== 'telop') return fail('対象のtelop itemがない');
        if (d.w12_change === 'size') {
            const key = roleKey(item, 'size');
            if (!key) return fail('size role宣言がない');
            const variable = presets[item.source.preset].variables.find(v => v.key === key);
            const current = item.source.params?.[key] ?? variable.default;
            const factor = SCALE_STEP[Math.max(0, Math.min(2, Math.round(d.amount ?? 1)))];
            const next = d.w12_adjust === 'set' ? d.w12_value
                : typeof current === 'number' && ['increase', 'decrease'].includes(d.w12_adjust)
                    ? Math.round(current * (d.w12_adjust === 'decrease' ? 1 / factor : factor)) : undefined;
            if (!Number.isFinite(next) || next <= 0) return fail('正の文字サイズまたは増減指定がない');
            // A baked cache describes the previous params; remove it on mutation.
            const edit = structuredClone(env.edit);
            const source = { ...item.source, params: { ...item.source.params, [key]: next } };
            delete source.baked;
            // updateItem deep-merges source, so removal must be explicit on the clone.
            delete env.editStore.locate(edit, item.id).item.source.baked;
            env.editStore.updateItem(edit, item.id, { source }); writeEdit(env, edit);
            env.log.push(`text_style_preset size ${item.id} ${key} → ${next}px（transform保持）`);
            return;
        }
        if (['stroke', 'background', 'font'].includes(d.w12_change)) {
            if (d.w12_change === 'font' && d.w12_font === 'none') return fail('変更先フォントが未指定');
            return fail(`${d.w12_change} roleの型・単位・描画への接続が未確認`);
        }
        if (d.w12_change === 'textstyle') return fail(`textstyle ${d.w12_style ?? 'none'} からtelop paramsへの完全な変換が未確認`);
        if (d.w12_change === 'animation') return fail(`textanim ${d.w12_slot ?? 'none'}/${d.w12_animation ?? 'none'} のtelopへの接続が未確認（caption animationとitem motionは別契約）`);
        if (d.w12_change === 'telop' && d.w12_mode === 'replace') {
            const declaration = presets[d.w12_template];
            if (!declaration) return fail('指定テンプレがカタログにない／未指定');
            const textKey = roleKey(item, 'text');
            const source = { kind: 'telop', preset: d.w12_template, params: Object.fromEntries(declaration.variables.map(v => [v.key, v.default])) };
            const nextKey = roleKey({ source }, 'text');
            if (!textKey || !nextKey || typeof item.source.params?.[textKey] !== 'string') return fail('元または変更先のtext role／本文が未確認');
            source.params[nextKey] = item.source.params[textKey];
            // Replace the source atomically: old template params/cache cannot leak.
            const edit = structuredClone(env.edit);
            env.editStore.locate(edit, item.id).item.source = source;
            writeEdit(env, edit);
            env.log.push(`text_style_preset template ${item.id} → ${d.w12_template}（本文・時刻・transform保持）`);
            return;
        }
        return fail('変更内容が選ばれていない');
    } };
