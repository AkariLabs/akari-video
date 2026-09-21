export default { id: 'other', apply(env, d) {
        const { log } = env;
        log.push(`→ LLM 層へ回す（op=${d.op}, target=${d.target}）。ここでは編集しない`);
    } };
