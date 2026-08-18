/**
 * 右パネル（縦アイコンバー）タブ順序の純ロジック（task 2026-08-17-shell-right-panel-order-and-focus
 * 指示1）。DOM / lumino TabBar に依存しない配列演算として切り出し、node --test で before/after を
 * 検証できるようにする。
 *
 * ルール: 固定 3 枚（RIGHT_PANEL_FIXED_ORDER 相当）を末尾へ寄せ、それ以外（エージェント端末タブ）は
 * 現在の相対順を保持したまま先頭に残す。固定 3 枚同士の相対順は fixedOrder の並びのまま。
 * 先頭を固定 3 枚が奪わない（＝将来右パネルの住人が増えても、その新顔は既定でエージェント側 = 先頭
 * 寄りに扱われて壊れない）方向で書く。
 */
export function computeRightPanelOrder(currentIds: readonly string[], fixedOrder: readonly string[]): string[] {
    const fixedSet = new Set(fixedOrder);
    const agentIds = currentIds.filter(id => !fixedSet.has(id));
    const fixedIds = fixedOrder.filter(id => currentIds.includes(id));
    return [...agentIds, ...fixedIds];
}
