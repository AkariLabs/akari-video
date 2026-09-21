import { targetItem } from '../ops/_knobs.mjs';
import { declarations } from '../v2/declared-knobs.mjs';
import { numeric } from '../exec-support/declared_knobs.mjs';
import { numbers } from '../exec-support/declared_knobs.mjs';
import { options } from '../exec-support/declared_knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'declared_knobs', apply(env, d) {
        const fail = reason => env.log.push(`declared_knobs ${d.target} → 未適用（${reason}）`);
        const item = targetItem(env, d.target, { materialize: false });
        const k = declarations(item).find(k => k.cssVar === d.declared_knobs_knob);
        if (!k) {
            const text = d.declared_knobs_text ?? '';
            if (/幅|横幅|狭く|広げ/.test(text)) return fail('この素材は幅のツマミを宣言していない');
            if (/文字|字|フォント/.test(text)) return fail('この素材は文字サイズのツマミを宣言していない');
            return fail('html 素材またはツマミ宣言が無い');
        }
        let value = d.declared_knobs_value;
        if (numeric(k)) {
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) return fail('数値が解決できない');
            const direction = d.declared_knobs_direction;
            if (['up','down'].includes(direction)) {
                const current = Number.parseFloat(item.source.vars?.[k.cssVar] ?? k.default);
                if (!Number.isFinite(current)) return fail('相対変更の現在値が無い');
                const amount = numbers(d.declared_knobs_text).at(-1) ?? (Number.isFinite(k.step) && k.step > 0 ? k.step
                    : Number.isFinite(k.min) && Number.isFinite(k.max) ? (k.max-k.min)*0.05 : Math.max(Math.abs(current)*0.1, 1));
                value = current + (direction === 'up' ? 1 : -1) * Math.abs(amount);
            }
            if (!Number.isFinite(value)) return fail('数値が解決できない');
            value = Math.max(k.min ?? -Infinity, Math.min(k.max ?? Infinity, value));
            value = `${Number(value.toFixed(6))}${k.unit ?? ''}`;
        } else if (k.type === 'color') {
            if (!Object.values(env.context.palette ?? {}).some(([, hex]) => hex === value)) return fail('パレットの色が解決できない');
        } else if (k.type === 'dropdown') {
            if (!options(k).some(o => o.value === value)) return fail('列挙値が解決できない');
        } else if (k.type === 'checkbox') {
            if (typeof value !== 'boolean') return fail('真偽値が解決できない');
            value = value ? '1' : '0';
        } else return fail(`型 ${k.type} の閉じた値候補は未対応`);
        patchItem(env, item.id, { source: { vars: { [k.cssVar]: value } } });
        env.log.push(`declared_knobs ${item.id} ${k.cssVar} → ${value}`);
    } };
