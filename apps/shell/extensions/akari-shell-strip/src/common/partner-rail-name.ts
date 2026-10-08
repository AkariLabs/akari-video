/** 端末や Web パートナーのタイトルから、右レール用の短い名前を作る。 */
export function railNameForPartner(id: string, label: string, caption?: string): string {
    if (id === 'akari-partner-onboarding') return 'パートナー';

    const fromLabel = label.match(/^チャット\s*·\s*(.+)$/)?.[1]
        ?? label.match(/^チャット（(.+)）$/)?.[1];
    const fromCaption = caption && /(?: CLI| 拡張| Harness)$/.test(caption) ? caption : undefined;
    const name = (fromLabel || fromCaption || '').trim()
        .replace(/(?: CLI| 拡張| Harness)$/, '');
    return name === 'Claude Code' ? 'Claude' : name || 'チャット';
}
