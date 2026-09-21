export default { id: 'followup_replies_listen', apply(env, d) {
        const mode = d.followup_listen_mode && d.followup_listen_mode !== 'none'
            ? d.followup_listen_mode : env.ctx.listening === false ? 'resume' : 'pause';
        env.log.push(`聞き取り ${mode} → 未適用（シェルのマイク制御の受け口が無い。live の USE_MIC/micStatus へ委譲が必要）`);
    } };
