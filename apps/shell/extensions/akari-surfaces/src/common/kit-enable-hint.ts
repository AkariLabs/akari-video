// packages/akari-launcher/src/kits.mjs の enableHint() が正本。この定数は UI 用の写し。
export const KIT_ENABLE_HINT = [
    'Claude Code で拡張キットを有効化してください:',
    '  claude plugin marketplace add ~/.akari/kits',
    '  claude plugin install akari-kits@akari-kits',
    'claude が PATH に無い場合は、Claude Code のプラグイン設定で ~/.akari/kits を marketplace として追加してください。'
].join('\n');
