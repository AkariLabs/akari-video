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

// package.json / tsconfig に拡張間依存を足せないため、実行時に同梱されるカタログ JSON を静的 require する。
// lib/browser からの相対位置でも解決でき、ビュー id の別表を持たずに済む。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const partnerCatalog = require('../../../akari-partner/src/common/partner-catalog.json') as Array<{ viewContainerIds?: string[] }>;
const partnerViewIds = new Set(partnerCatalog.flatMap(entry => entry.viewContainerIds ?? [])
    .map(id => `plugin-view-container:${id}`));

export const isTransientRailId = (id: string): boolean => /^terminal-\d+$/.test(id);

/** 既定の所属: パートナーを追加・端末・カタログ掲載の拡張ビューが上、未知の新顔は下。 */
export function defaultRightRailGroup(id: string): RightRailGroup {
    return id === RIGHT_RAIL_PARTNER_ID || isTransientRailId(id) || partnerViewIds.has(id) ? 'agent' : 'lower';
}

/** 保存された並びに新顔を既定順で差し込み、既存の利用者順を保つ。 */
function mergeOrder(defaultIds: string[], saved: readonly string[]): string[] {
    if (!saved.length) {
        return defaultIds;
    }
    const present = new Set(defaultIds);
    const ordered = saved.filter(id => present.has(id));
    const known = new Set(ordered);
    for (let index = 0; index < defaultIds.length; index++) {
        const id = defaultIds[index];
        if (known.has(id)) {
            continue;
        }
        const next = defaultIds.slice(index + 1).find(candidate => known.has(candidate));
        ordered.splice(next ? ordered.indexOf(next) : ordered.length, 0, id);
        known.add(id);
    }
    return ordered;
}

export function computeRightPanelOrder(
    currentIds: readonly string[],
    fixedOrder: readonly string[],
    groupOf?: (id: string) => RightRailGroup,
    savedOrder: readonly string[] = []
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
    const agent = [...looseIn('agent'), ...partnerLast];
    const lower = [...fixedIn('lower'), ...looseIn('lower')];
    return [
        ...mergeOrder(agent.filter(id => id !== RIGHT_RAIL_PARTNER_ID), savedOrder),
        ...agent.filter(id => id === RIGHT_RAIL_PARTNER_ID),
        ...mergeOrder(lower, savedOrder)
    ];
}
