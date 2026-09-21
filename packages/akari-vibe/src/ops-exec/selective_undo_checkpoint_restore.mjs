import { entries } from '../exec-support/selective_undo_checkpoint_undo.mjs';
import { POINT } from '../exec-support/selective_undo_checkpoint_undo.mjs';
export default { id: 'selective_undo_checkpoint_restore', apply(env, d) {
        const matches = entries(env.ctx, 'checkpoints').filter(p => `cp_${p.id}` === d[POINT]);
        const reason = matches.length !== 1 ? '保存を一意に特定できない' : 'projectDir と非同期 history-store.restore の受け口が apply env に無い（メタデータだけでは復元できない）';
        env.log.push(`checkpoint_restore → 未適用（${reason}）`);
    } };
