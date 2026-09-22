import { defaultRightRailGroup, RightRailGroup } from 'akari-annotations/lib/browser/right-panel-order';

/**
 * 右レールの状態（task 2026-09-22-right-rail-regroup）。DOM / Lumino に依存しない純ロジック。
 * 見た目と動きの正は内部リポの試作 planning/notes-2026-09-22-right-rail-prototype.html（2 版）で、
 * その drop(k, where) / レールのクリック / × / 境目の規則をそのまま写す。
 *
 * - 所属（上 = エージェント / 下 = それ以外）は既定（defaultRightRailGroup）との差分だけを持つ
 * - 右パネルは既定で 1 面。1 面のとき「どれが出ているか」は Theia の縦バーの currentTitle が正で、
 *   ここでは持たない。2 段のときだけ top / bottom / focus を持つ
 * - 2 段の規則 = 区切り線どおり: 上の段には所属が上のもの、下の段には所属が下のものだけが出る
 * - displaced = レールからメイン / 下へ出したパネル（レールへ戻すと消える）
 */
export type RightRailSlot = 'top' | 'bottom';
export type RightRailArea = 'main' | 'bottom';
export type RightRailZone = 'main' | 'bottom' | 'railtop' | 'railbottom' | 'rtop' | 'rbottom';

export interface RightRailState {
    version: 1;
    groups: Record<string, RightRailGroup>;
    split: boolean;
    top: string | null;
    bottom: string | null;
    focus: RightRailSlot;
    /** 2 段のときの上の段の割合（境目の位置）。 */
    ratio: number;
    displaced: Record<string, RightRailArea>;
}

/** 境目をここより端へ寄せて離すと 1 面に戻る（試作と同じ 12%）。 */
export const RIGHT_RAIL_COLLAPSE_EDGE = 0.12;
export const RIGHT_RAIL_DEFAULT_RATIO = 0.5;

export function defaultRightRailState(): RightRailState {
    return { version: 1, groups: {}, split: false, top: null, bottom: null, focus: 'top', ratio: RIGHT_RAIL_DEFAULT_RATIO, displaced: {} };
}

export function cloneRightRailState(state: RightRailState): RightRailState {
    return { ...state, groups: { ...state.groups }, displaced: { ...state.displaced } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 256;

/**
 * 保存データの読み取り。1 か所でも形が壊れていたら部分救済せず、まるごと既定（1 面・既定の所属）に落とす。
 * 保存データが無い（旧レイアウト）ときも既定。
 */
export function readRightRailState(raw: unknown): RightRailState {
    const fallback = defaultRightRailState();
    if (raw === undefined || raw === null) {
        return fallback;
    }
    if (!isRecord(raw) || raw.version !== 1) {
        return fallback;
    }
    const { groups, split, top, bottom, focus, ratio, displaced } = raw;
    if (!isRecord(groups) || !isRecord(displaced) || typeof split !== 'boolean') {
        return fallback;
    }
    if (!Object.entries(groups).every(([id, group]) => isId(id) && (group === 'agent' || group === 'lower'))) {
        return fallback;
    }
    if (!Object.entries(displaced).every(([id, area]) => isId(id) && (area === 'main' || area === 'bottom'))) {
        return fallback;
    }
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < RIGHT_RAIL_COLLAPSE_EDGE || ratio > 1 - RIGHT_RAIL_COLLAPSE_EDGE) {
        return fallback;
    }
    if (focus !== 'top' && focus !== 'bottom') {
        return fallback;
    }
    if (split) {
        if (!isId(top) || !isId(bottom) || top === bottom) {
            return fallback;
        }
    } else if (top !== null || bottom !== null) {
        return fallback;
    }
    return {
        version: 1,
        groups: groups as Record<string, RightRailGroup>,
        split,
        top: split ? top as string : null,
        bottom: split ? bottom as string : null,
        focus,
        ratio,
        displaced: displaced as Record<string, RightRailArea>
    };
}

export function rightRailGroupOf(state: RightRailState, id: string): RightRailGroup {
    return state.groups[id] ?? defaultRightRailGroup(id);
}

/** 既定と同じ所属なら差分を消す（保存データを最小に保つ）。 */
export function setRightRailGroup(state: RightRailState, id: string, group: RightRailGroup): void {
    if (defaultRightRailGroup(id) === group) {
        delete state.groups[id];
    } else {
        state.groups[id] = group;
    }
}

const slotOfGroup = (group: RightRailGroup): RightRailSlot => group === 'agent' ? 'top' : 'bottom';
const otherSlot = (slot: RightRailSlot): RightRailSlot => slot === 'top' ? 'bottom' : 'top';

/** 2 段を閉じて 1 面に戻す。残った方の id を返す（パネル自体はレールに残る）。 */
export function unsplitRightRail(state: RightRailState, keep: RightRailSlot): string | null {
    const kept = state[keep];
    state.split = false;
    state.top = null;
    state.bottom = null;
    state.focus = 'top';
    return kept;
}

/** 段の見出しの ×: その段を閉じ、もう一方を 1 面で残す。 */
export function closeRightRailPane(state: RightRailState, slot: RightRailSlot): string | null {
    return unsplitRightRail(state, otherSlot(slot));
}

/** 境目を離したとき。端まで寄せていたら 1 面に戻し、残った id を返す。それ以外は比率を記録して undefined。 */
export function settleRightRailRatio(state: RightRailState, ratio: number): string | null | undefined {
    if (!state.split || !Number.isFinite(ratio)) {
        return undefined;
    }
    if (ratio < RIGHT_RAIL_COLLAPSE_EDGE) {
        state.ratio = RIGHT_RAIL_DEFAULT_RATIO;
        return unsplitRightRail(state, 'bottom');
    }
    if (ratio > 1 - RIGHT_RAIL_COLLAPSE_EDGE) {
        state.ratio = RIGHT_RAIL_DEFAULT_RATIO;
        return unsplitRightRail(state, 'top');
    }
    state.ratio = ratio;
    return undefined;
}

export function rightRailPaneOf(state: RightRailState, id: string): RightRailSlot | undefined {
    if (!state.split) {
        return undefined;
    }
    return state.top === id ? 'top' : state.bottom === id ? 'bottom' : undefined;
}

/**
 * 2 段のときのレールのクリック。出ている物なら段のフォーカスを移すだけ、出ていなければ
 * 所属の段（線の上 → 上の段 / 線の下 → 下の段）を差し替えてフォーカスする。1 面のときは何もしない
 * （Theia 既定の「押したものが出る / 出ているものを押すと畳む」）。
 */
export function clickRightRail(state: RightRailState, id: string): RightRailSlot | undefined {
    if (!state.split) {
        return undefined;
    }
    const shown = rightRailPaneOf(state, id);
    if (shown) {
        state.focus = shown;
        return shown;
    }
    const slot = slotOfGroup(rightRailGroupOf(state, id));
    state[slot] = id;
    state.focus = slot;
    return slot;
}

export interface RightRailDropContext {
    /** 右（レール）にいまある id（レールの並び順）。 */
    readonly railIds: readonly string[];
    /** 1 面のとき出ている id（畳んでいれば null）。 */
    readonly current: string | null;
}

export interface RightRailDropResult {
    /** 実際に widget を動かす先。undefined なら置き場所はそのまま。 */
    moveTo?: 'main' | 'bottom' | 'right';
    /** 1 面のときに出すもの（undefined = 変えない、null = 畳む）。2 段のときは focus 側の id。 */
    current?: string | null;
}

/**
 * パネルを置いたとき（試作の drop(k, where)）。state を書き換え、動かす先と出すものを返す。
 */
export function dropOnRightRail(state: RightRailState, id: string, zone: RightRailZone, context: RightRailDropContext): RightRailDropResult {
    const inRight = context.railIds.includes(id);
    const result: RightRailDropResult = {};
    /** 右から外れるときの後始末（2 段で出ていたら 1 面に戻す / 1 面で出ていたら次のものへ）。 */
    const detach = (): void => {
        const pane = rightRailPaneOf(state, id);
        if (pane) {
            result.current = closeRightRailPane(state, pane);
        } else if (!state.split && context.current === id) {
            result.current = context.railIds.find(other => other !== id) ?? null;
        }
    };
    if (zone === 'main' || zone === 'bottom') {
        if (inRight) {
            detach();
        }
        state.displaced[id] = zone;
        result.moveTo = zone;
        return result;
    }
    if (zone === 'railtop' || zone === 'railbottom') {
        if (rightRailPaneOf(state, id)) {
            detach();
        }
        setRightRailGroup(state, id, zone === 'railtop' ? 'agent' : 'lower');
        delete state.displaced[id];
        if (!inRight) {
            result.moveTo = 'right';
            if (!state.split && context.current === null && context.railIds.length === 0) {
                result.current = id;
            }
        }
        return result;
    }
    // rtop / rbottom: そのときだけ 2 段に分ける。置いた段に合わせて所属も揃える（区切り線どおり）。
    const slot: RightRailSlot = zone === 'rtop' ? 'top' : 'bottom';
    const other = otherSlot(slot);
    const group: RightRailGroup = slot === 'top' ? 'agent' : 'lower';
    const flipped: RightRailGroup = group === 'agent' ? 'lower' : 'agent';
    setRightRailGroup(state, id, group);
    if (!inRight) {
        result.moveTo = 'right';
        delete state.displaced[id];
    }
    const candidates = context.railIds.filter(other2 => other2 !== id);
    let partner = state.split ? state[other] : context.current;
    if (!partner || partner === id || !candidates.includes(partner)) {
        partner = candidates.find(candidate => rightRailGroupOf(state, candidate) === flipped) ?? candidates[0] ?? null;
    }
    if (!partner) {
        // 右に他のパネルが無いと 2 段にできない。置いたものを 1 面で出す。
        if (state.split) {
            unsplitRightRail(state, slot);
        }
        result.current = id;
        return result;
    }
    if (rightRailGroupOf(state, partner) === group) {
        setRightRailGroup(state, partner, flipped);
    }
    state.split = true;
    state[slot] = id;
    state[other] = partner;
    state.focus = slot;
    result.current = id;
    return result;
}

/**
 * レールの中身が変わったあと（復元・追加・削除）に 2 段の整合を取る。出ている段の物が
 * 右から居なくなった / 区切り線どおりでなくなったら 1 面に戻し、残す id を返す。
 */
export function normalizeRightRail(state: RightRailState, railIds: readonly string[]): string | null | undefined {
    if (!state.split) {
        return undefined;
    }
    const topOk = !!state.top && railIds.includes(state.top) && rightRailGroupOf(state, state.top) === 'agent';
    const bottomOk = !!state.bottom && railIds.includes(state.bottom) && rightRailGroupOf(state, state.bottom) === 'lower';
    if (topOk && bottomOk) {
        return undefined;
    }
    if (topOk) {
        return unsplitRightRail(state, 'top');
    }
    if (bottomOk) {
        return unsplitRightRail(state, 'bottom');
    }
    unsplitRightRail(state, 'top');
    return null;
}
