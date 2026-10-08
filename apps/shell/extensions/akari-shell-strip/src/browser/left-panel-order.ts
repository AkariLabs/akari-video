/** 固定タブを定義順で先頭へ寄せ、その他は現在の相対順で末尾に残す。未接続の ID は追加しない。 */
export function computeLeftPanelOrder(currentIds: readonly string[], fixedOrder: readonly string[]): string[] {
    const currentSet = new Set(currentIds);
    const fixedSet = new Set(fixedOrder);
    return [
        ...fixedOrder.filter(id => currentSet.has(id)),
        ...currentIds.filter(id => !fixedSet.has(id))
    ];
}

/** Return the previously visible left tab, or keep the panel closed. */
export function resolveLeftPanelRestore(
    currentIds: readonly string[], lastSelectedId: string | undefined, wasCollapsed: boolean
): string | null {
    if (wasCollapsed) {
        return null;
    }
    const candidates = currentIds.filter(id => id !== 'akari-home-opener');
    return (lastSelectedId && candidates.includes(lastSelectedId) ? lastSelectedId : candidates[0]) ?? null;
}
