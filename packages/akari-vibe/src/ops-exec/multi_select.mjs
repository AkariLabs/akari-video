import { inventory } from '../exec-support/multi_select.mjs';
import { editStore } from '../edit-store.mjs';
export default { id: 'multi_select', apply(env, d) {
        // Shared apply calls once per target. Replace the full selection atomically only once.
        if (env.w16SelectionApplied) return;
        env.w16SelectionApplied = true;
        const stop = reason => env.log.push(`multi_select → 未適用（${reason}）`);
        if (d.w16_unapplied) return stop(d.w16_unapplied);
        if (!Array.isArray(d.targets) || !d.targets.length) return stop('選択対象配列が無い');
        const pool = inventory(env.edit);
        if (d.targets.some(key => !pool.some(it => it.key === key))) return stop('存在しない対象が含まれる');
        editStore.readEditV2(JSON.parse(env.source));
        env.selection = pool.filter(it => d.targets.includes(it.key)).map(it => it.selection);
        env.ctx = { ...env.ctx, selection: [...env.selection] };
        env.log.push(`multi_select → ctx.selection=${JSON.stringify(env.selection)}（edit.json は変更なし）`);
    } };
