export default { id: 'selective_undo_checkpoint_save', apply(env) {
        // history-store.snapshot({projectDir,label}) is async and persists project files.
        // applyDecision's synchronous env has no projectDir or checkpoint persistence.
        env.log.push('checkpoint_save → 未適用（projectDir と永続保存の受け口が apply env に無い）');
    } };
