import { externalCandidates } from '../exec-support/companion-commands.mjs';
export default { id: 'shell_ui_external', apply(env, d) {
        const candidates = externalCandidates(d.shell_ui_text ?? '');
        const candidate = candidates.find(c => c.key === d.shell_ui_external_target);
        if (!candidate) { env.log.push('外部を開く → 未適用（対象の候補が未指定・不明）'); return; }
        const ticket = { kind: candidate.kind, target: candidate.value, action: 'open', execute: false };
        env.log.push(`外部起動票 ${JSON.stringify(ticket)}${candidate.available ? '（lab 記録のみ、実際には開かない）' : ' → 未適用（アプリの登録先・起動受け口が未確認）'}`);
    } };
