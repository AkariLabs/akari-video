export default { id: 'followup_replies_cancel', apply(env) {
        // ctx はケース・live の所有物なので、ここでは lastAsk を変更しない。
        env.log.push('聞き返しを取り下げ（編集なし）（聞き返しを閉じる → live 側）');
    } };
