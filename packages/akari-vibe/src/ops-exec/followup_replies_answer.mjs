import { byId } from '../exec-support/followup_replies_answer.mjs';
export default { id: 'followup_replies_answer', apply(env, d) {
        const pick = d.followup_reply_pick ?? 'none';
        const skip = reason => env.log.push(`followup 返事 ${pick} → 未適用（${reason}）`);
        const ask = env.ctx?.lastAsk;
        if (!ask) return skip('直前の聞き返しが無い');
        if (pick === 'no') {
            env.log.push('聞き返しを取り下げ（編集なし）（聞き返しを閉じる → live 側）');
            return;
        }
        if (pick === 'none') return skip('候補が決まっていない');
        if (!ask.options?.some(o => o.key === pick)) return skip('聞き返しの選択肢に無い');
        const pending = ask.pending;
        if (!pending) return skip('pending が無い');
        const op = byId?.get(pending.op);
        if (!op) return skip('pending.op が未登録、または操作カタログの準備が未完了');
        if (pending.op.startsWith('followup_replies_')) return skip('聞き返し操作への再帰委譲はできない');
        const { slot = 'target', ...decision } = pending;
        if (pick !== 'yes') decision[slot] = pick;
        op.apply(env, decision);
        // ctx は呼び出し側の所有物。聞き返しのライフサイクルは live 側で管理する。
        env.log.push('（聞き返しを閉じる → live 側）');
    } };
