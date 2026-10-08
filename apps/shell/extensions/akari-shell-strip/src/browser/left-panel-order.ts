/** 固定タブを定義順で先頭へ寄せ、その他は現在の相対順で末尾に残す。未接続の ID は追加しない。 */
export function computeLeftPanelOrder(currentIds: readonly string[], fixedOrder: readonly string[]): string[] {
    const currentSet = new Set(currentIds);
    const fixedSet = new Set(fixedOrder);
    return [
        ...fixedOrder.filter(id => currentSet.has(id)),
        ...currentIds.filter(id => !fixedSet.has(id))
    ];
}
