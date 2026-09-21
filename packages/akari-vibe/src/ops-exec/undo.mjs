export default { id: 'undo', apply(env, d) {
        const { log } = env;
        log.push('undo（シェルの undo スタックへ委譲）');
    } };
