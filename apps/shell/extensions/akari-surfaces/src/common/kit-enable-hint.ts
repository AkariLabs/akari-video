import { t } from '@akari-video/i18n';
// packages/akari-launcher/src/kits.mjs の enableHint() が正本。この定数は UI 用の写し。
export const KIT_ENABLE_HINT = [
    t('surfaces.kits.activateExpansionKitClaudeCode.label'),
    '  claude plugin marketplace add ~/.akari/kits',
    '  claude plugin install akari-kits@akari-kits',
    t('surfaces.kits.claudePathAddAkariKitsMarketplaceClaude.description')
].join('\n');
