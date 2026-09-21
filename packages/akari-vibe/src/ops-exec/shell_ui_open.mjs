import { shellCatalog } from '../exec-support/companion-commands.mjs';
export default { id: 'shell_ui_open', apply(env, d) {
        const entry = shellCatalog.entries.find(e => e.key === d.shell_ui_target);
        if (!entry?.available) {
            env.log.push(`その画面はまだ声で開けない: ${d.shell_ui_target ?? '未指定'} → 未適用（${entry?.reason ?? '対象の受け口・タブ履歴が未確認'}）`);
            return;
        }
        // Combined requests need a multi-target contract; don't silently open only one side.
        if (/編集データとプレビュー/.test(d.shell_ui_text ?? '')) {
            env.log.push('編集データとプレビュー → 未適用（複数画面の同時オープン受け口が未接続）');
            return;
        }
        // companion 経由なら実物のシェルへ command を送る（許可一覧にある id だけ）。
        // それ以外（fixture・オフライン検査）は今までどおり模擬のログ。
        const commandId = entry.commandId;
        if (env.companion && env.sendCommand && typeof commandId === 'string') {
            env.log.push(`${entry.label} → 開いた ${JSON.stringify({ commandId })}`);
            void env.sendCommand(commandId, entry.args);
            return;
        }
        env.log.push(`${entry.label} → 開いた（lab 模擬） ${JSON.stringify({ ...entry.receiver, source: entry.source })}`);
    } };
