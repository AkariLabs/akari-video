import { t } from './shell-text';
/** 端末や Web パートナーのタイトルから、右レール用の短い名前を作る。 */
export function railNameForPartner(id: string, label: string, caption?: string): string {
    if (id === 'akari-partner-onboarding') return t('shell.rightRail.partnerName.partnerLabel');

    // 端末の caption は「Claude Code CLI（自動モードで起動）」のように末尾に（…）が付く
    const bareCaption = caption?.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
    const fromCaption = bareCaption && (id === 'akari-partner-web' || /(?: CLI| 拡張| Extension| Harness)$/.test(bareCaption)) ? bareCaption : undefined;
    // The caption carries the agent name. Older tabs without one keep only the name after a separator.
    const fromLabel = label.split(/\s*·\s*/, 2)[1] ?? /[（(]([^（）()]+)[）)]$/.exec(label)?.[1];
    const name = (fromCaption || fromLabel || '').trim()
        .replace(/(?: CLI| 拡張| Extension| Harness)$/, '');
    return name === 'Claude Code' ? 'Claude' : name || t('shell.rightRail.partnerName.chatLabel');
}
