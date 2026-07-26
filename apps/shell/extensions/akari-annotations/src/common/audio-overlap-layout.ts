import { assignSubRows } from './lane-layout';

export interface AudioOverlapItem {
    id: string;
    /** 実際の宣言済み ref（sfx.track ?? 0）。 */
    track: number;
    start: number;
    end: number;
}

export interface AudioOverlapSyntheticTrack {
    id: string;
    ref: number;
}

export interface AudioOverlapLayout {
    /** item.id → 表示上の割当 ref。実際の track と異なる場合のみキーを持つ（重ならなければ空）。 */
    overrides: Map<string, number>;
    /** 重なり解消のために新設が必要な「表示上」トラック（edit.json には書かない）。 */
    syntheticTracks: AudioOverlapSyntheticTrack[];
}

/**
 * R7-3・読み込み時の重なり自動配置の中核アルゴリズム。同一 ref 内で時間が重なる項目を
 * 検知し、表示上の別トラック（virtual ref）へ決定的に振り分ける。edit.json は一切参照・
 * 変更しない純粋関数（widget からは描画用に導出したデータを渡すだけ）。
 *
 * 各 ref グループ内で assignSubRows（greedy interval partitioning）による lane 割当を行い、
 * lane 0 はその ref に留める（実データと最も近い、無変更のケース）。lane 1 以上は
 * ref ごと・lane ごとに 1 つの新しい virtual ref を割り当てる（宣言済み ref の最大値+1 から
 * 連番）。同じ (ref, lane) の組は常に同じ virtual ref を指すため、互いに重ならない項目群が
 * 1 本の表示トラックを安全に共有できる。
 *
 * 「宣言なき ref」の救済: items の中には、宣言済み（declaredRefs）ではない ref を持つものが
 * 混在しうる（例: ユーザーが表示専用の自動配置トラックへ sfx をドラッグし、その virtual ref
 * が実際に sfx.track として書き戻された後、次回計算時にその ref はもう「重なりが検知される
 * 動的な virtual ref」ではなく「実データが直接指す ref」になっている）。このような ref にも
 * 必ず 1 本の表示行を用意しないと、対象の項目が描画先を失って消えてしまう。そのため
 * declaredRefs に無いが items が直接参照している ref は、重なりの有無に関わらず lane 0 用の
 * プレースホルダ行を用意する。
 *
 * 決定性: assignSubRows は入力の並び順（items の配列順）に対して安定なため、
 * 呼び出し側が同じ順序（edit.json 上の出現順）で items を渡す限り、同じ入力に対して
 * 常に同じ振り分けになる。
 */
export function computeAudioOverlapLayout(
    items: readonly AudioOverlapItem[],
    declaredRefs: readonly number[]
): AudioOverlapLayout {
    const overrides = new Map<string, number>();
    const syntheticTracks: AudioOverlapSyntheticTrack[] = [];
    const realRefs = new Set<number>(declaredRefs);
    const allRefs = new Set<number>(realRefs);
    for (const item of items) {
        allRefs.add(item.track);
    }
    if (allRefs.size === 0) {
        return { overrides, syntheticTracks };
    }
    let nextVirtualRef = Math.max(...allRefs) + 1;
    for (const ref of [...allRefs].sort((left, right) => left - right)) {
        if (!realRefs.has(ref)) {
            syntheticTracks.push({ id: `t-audio-implied-${ref}`, ref });
        }
        const refItems = items.filter(item => item.track === ref);
        if (refItems.length < 2) {
            continue;
        }
        const lanes = assignSubRows(refItems.map(item => ({ start: item.start, end: item.end })));
        const laneVirtualRef = new Map<number, number>();
        refItems.forEach((item, index) => {
            const lane = lanes[index];
            if (lane === 0) {
                return;
            }
            let virtualRef = laneVirtualRef.get(lane);
            if (virtualRef === undefined) {
                virtualRef = nextVirtualRef++;
                laneVirtualRef.set(lane, virtualRef);
                syntheticTracks.push({ id: `t-audio-auto-${ref}-${lane}`, ref: virtualRef });
            }
            overrides.set(item.id, virtualRef);
        });
    }
    return { overrides, syntheticTracks };
}
