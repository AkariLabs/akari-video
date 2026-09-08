/**
 * 文字起こしパネル（1 行 = 1 字幕の Monaco 編集）で **行数が変わる編集** をしたときの
 * 「行の差分 → 字幕操作列」への写像と、その操作に伴う時刻割り付け・id 採番。
 * task 2026-09-08-caption-line-ops（issue #66）の指示 (A) / (B) / (D)。
 *
 * ここに置くのは決定論的な純関数だけ（DOM・時刻・乱数に依存しない = 同じ入力なら同じ操作列）。
 * 実際の captions.json への書き戻しは呼び出し側が既存の外科手術関数
 * （replaceCaptionLine / insertCaptionLine / removeCaptionLine / setCaptionTimingLine）へ落とす。
 */
/** 分割後・追加後の 1 行が最低限持つ表示尺（秒）。これを割るときは操作を拒否する。 */
export declare const CAPTION_LINE_MIN_SECONDS = 0.2;
/**
 * 末尾（次の字幕が無い場所）へ字幕を足すときの既定尺（秒）。
 * edit-lint の captions.short-duration（1.0 秒未満で warning）に自分から当たらない値を取る。
 */
export declare const CAPTION_LINE_DEFAULT_SECONDS = 1;
export type CaptionLineOp = {
    readonly kind: 'replace';
    readonly id: string;
    readonly text: string;
} | {
    readonly kind: 'split';
    readonly id: string;
    readonly texts: string[];
} | {
    readonly kind: 'merge';
    readonly ids: string[];
    readonly text: string;
} | {
    readonly kind: 'remove';
    readonly id: string;
} | {
    readonly kind: 'insert';
    readonly afterId: string | undefined;
    readonly text: string;
};
export interface CaptionLineSpan {
    start: number;
    end: number;
}
/**
 * baseline（保存済みの表示行）と next（編集後の表示行）の差分を字幕操作列へ写す。
 *
 * アルゴリズムは先頭・末尾から一致行を削る古典的な差分（LCS は使わない）。中央に残った
 * 「旧 n 行 → 新 m 行」の塊を次の順に落とす:
 *   - n === 1 && m > 1  → split
 *   - n > 1  && m === 1 → merge
 *   - それ以外          → min(n, m) 組を replace（テキストが変わった行だけ）+ 余りを remove / insert
 *
 * 中央の塊は 1 つしか残らないので、split と remove のような別種の操作が 1 回の呼び出しで
 * 同時に出ることはない（連続した編集はそのたびに呼ばれる）。
 */
export declare function diffCaptionLines(baseline: readonly string[], next: readonly string[], captions: readonly {
    id: string;
}[]): CaptionLineOp[];
/**
 * split の時刻割り付け（指示 B-2）。元の [start, end] を分割後テキストの **文字数比** で按分し、
 * 境界は元の区間内に収める。words があっても使わない（words の無い字幕と同じ挙動を優先する）。
 * どれか 1 つでも minSeconds を持てないときは undefined を返す（= 分割を拒否）。
 */
export declare function planSplitSpans(start: number, end: number, texts: readonly string[], minSeconds?: number): CaptionLineSpan[] | undefined;
/**
 * insert の時刻割り付け（指示 B-5）。直前行の end から次行の start までの隙間へ count 行を置く。
 * 隙間が count × minSeconds に足りないときは undefined を返す（= 追加を拒否）。
 * 次行が無い（末尾への追加）ときは隙間の上限が無いので CAPTION_LINE_DEFAULT_SECONDS ずつ並べる。
 */
export declare function planInsertSpans(previousEnd: number, nextStart: number | undefined, count: number, minSeconds?: number): CaptionLineSpan[] | undefined;
/**
 * `c-0001`, `c-0002`, ... のうち既存 id と衝突しないものを順に返す採番器
 * （timeline-material-insert.ts の nextSourceId と同型: 使用済み集合 + 衝突する限り繰り上げ）。
 */
export declare function createCaptionIdAllocator(existingIds: Iterable<string>): () => string;
