export default { id: 'captions', apply(env, d) {
        const { log } = env;
        log.push(`→ エージェント層へ回す（${d.op}: 既存スキルの仕事。target=${d.target}）`);
    } };
