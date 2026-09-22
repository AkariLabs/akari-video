/**
 * 右パネル（縦アイコンバー）タブ順序の純ロジック（task 2026-08-17-shell-right-panel-order-and-focus
 * 指示1）。DOM / lumino TabBar に依存しない配列演算として切り出し、node --test で before/after を
 * 検証できるようにする。
 *
 * ルール: 固定 3 枚（RIGHT_PANEL_FIXED_ORDER 相当）を末尾へ寄せ、それ以外（エージェント端末タブ）は
 * 現在の相対順を保持したまま先頭に残す。固定 3 枚同士の相対順は fixedOrder の並びのまま。
 * 先頭を固定 3 枚が奪わない（＝将来右パネルの住人が増えても、その新顔は既定でエージェント側 = 先頭
 * 寄りに扱われて壊れない）方向で書く。
 *
 * 追記（task 2026-09-22-right-rail-regroup）: レールは 1 本のまま真ん中に区切り線を持ち、
 * 線の上 = AI エージェント（パートナー端末 + パートナーを追加）、線の下 = それ以外になった。
 * 所属（上 / 下）はドラッグで入れ替えられるため、`groupOf` を渡したときは所属ごとの 2 区画で並べる:
 *   上: 所属が上の非固定 id（端末など・相対順を保持）→ 所属が上の固定 id（fixedOrder 順）→ パートナーを追加
 *   下: 所属が下の固定 id（fixedOrder 順）→ 所属が下の非固定 id（相対順を保持）
 * `groupOf` を渡さない呼び出しは従来どおり（非固定を先頭・固定を末尾）。
 */
export type RightRailGroup = 'agent' | 'lower';

/** 「パートナーを追加」（オンボーディング）。上の区画の末尾に置く。 */
export const RIGHT_RAIL_PARTNER_ID = 'akari-partner-onboarding';

/**
 * 右レールの固定の住人（上から: パートナーを追加 → 台本 → カット → 注釈 → インスペクター → 音声メーター）。
 * akari-annotations-contribution.ts の RIGHT_PANEL_FIXED_ORDER と akari-shell-strip の右パネルハンドラーが
 * 同じ並びを使う（ハンドラーは各 widget のモジュールを import できないので id の文字列で持つ）。
 */
export const RIGHT_RAIL_FIXED_ORDER: readonly string[] = [
    RIGHT_RAIL_PARTNER_ID,
    'akari-daihon-widget',
    'akari-cuts-widget',
    'akari-review-panel-widget',
    'akari-inspector-widget',
    'akari-audio-meter-widget'
];

/** 既定の所属: パートナーを追加と Theia の端末（terminal-<n>）が上、それ以外（未知の新顔も）は下。 */
export function defaultRightRailGroup(id: string): RightRailGroup {
    return id === RIGHT_RAIL_PARTNER_ID || /^terminal-\d+$/.test(id) ? 'agent' : 'lower';
}

export function computeRightPanelOrder(
    currentIds: readonly string[],
    fixedOrder: readonly string[],
    groupOf?: (id: string) => RightRailGroup
): string[] {
    const fixedSet = new Set(fixedOrder);
    if (!groupOf) {
        const agentIds = currentIds.filter(id => !fixedSet.has(id));
        const fixedIds = fixedOrder.filter(id => currentIds.includes(id));
        return [...agentIds, ...fixedIds];
    }
    const present = new Set(currentIds);
    const fixedIn = (group: RightRailGroup) => fixedOrder.filter(id => present.has(id) && groupOf(id) === group);
    const looseIn = (group: RightRailGroup) => currentIds.filter(id => !fixedSet.has(id) && groupOf(id) === group);
    const agentFixed = fixedIn('agent');
    const partnerLast = agentFixed.filter(id => id !== RIGHT_RAIL_PARTNER_ID);
    if (agentFixed.includes(RIGHT_RAIL_PARTNER_ID)) {
        partnerLast.push(RIGHT_RAIL_PARTNER_ID);
    }
    return [...looseIn('agent'), ...partnerLast, ...fixedIn('lower'), ...looseIn('lower')];
}
