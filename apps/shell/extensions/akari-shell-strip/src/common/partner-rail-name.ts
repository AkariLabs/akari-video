/** 端末や Web パートナーのタイトルから、右レール用の短い名前を作る。 */
export function railNameForPartner(id: string, label: string, caption?: string): string {
    if (id === 'akari-partner-onboarding') return 'パートナー';

    const fromLabel = label.match(/^チャット\s*·\s*(.+)$/)?.[1]
        ?? label.match(/^チャット（(.+)）$/)?.[1];
    // 端末の caption は「Claude Code CLI（自動モードで起動）」のように末尾に（…）が付く
    const bareCaption = caption?.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
    const fromCaption = bareCaption && /(?: CLI| 拡張| Harness)$/.test(bareCaption) ? bareCaption : undefined;
    const name = (fromLabel || fromCaption || '').trim()
        .replace(/(?: CLI| 拡張| Harness)$/, '');
    return name === 'Claude Code' ? 'Claude' : name || 'チャット';
}
