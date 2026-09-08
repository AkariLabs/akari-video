/**
 * グローバルなファイルドロップを「委譲するか / 自分で拾うか」を決める純関数
 * （task 2026-09-08-timeline-file-drop 指示1・2・14）。
 *
 * 経緯: 委譲判定はもともと `data-akari-dropzone` の内側かどうかだけを見ていた。ところが
 * 委譲先（素材パネル・タイムライン）の drop ハンドラは**自分の MIME 以外を無視して return** する
 * ため、OS からのファイルドロップは「グローバル経路が降り、委譲先も拾わない」で無反応に落ちていた
 * （実機報告 2026-09-08 / issue #63 — タイムライン帯にドロップするとトースト無しで何も起きない）。
 *
 * 委譲規約はこう決めた: **AKARI 内部ドラッグ（自前 MIME 付き）のときだけ委譲する**。
 * OS ファイルドロップ（`types` に `Files` があり内部 MIME が無い）はグローバル経路が拾う。
 *
 * DOM に一切依存しないため node --test で検証できる。DOM 層（`closest()` と
 * `DataTransfer.types` の読み取り）は呼び出し側の薄いラッパが持つ。
 */

/**
 * AKARI 内部ドラッグの MIME。送信側（akari-role-buckets-widget.tsx）・受け側
 * （akari-annotations-widget.ts）と独立にリテラル宣言する既存の流儀に合わせる
 * — 拡張をまたぐ import は作らない。
 */
export const MATERIAL_DRAG_MIME = 'application/x-akari-material';
export const LIBRARY_DRAG_MIME = 'application/x-akari-library-item';

/** `isDelegatedDropInput` の入力（DOM 非依存に落とした drop / dragover の状態）。 */
export interface DelegatedDropInput {
    /** `data-akari-dropzone` を持つ要素の内側で起きたイベントか。 */
    readonly insideDropzone: boolean;
    /** `DataTransfer.types` の写し。dragover 中でも読める（getData と違い types は読める）。 */
    readonly types: readonly string[];
}

/**
 * その場所の実装に委ねる（＝グローバル経路が手を出さない）ドロップかどうか。
 * dropzone の内側 **かつ** 内部 MIME を持つときだけ true。
 */
export function isDelegatedDropInput(input: DelegatedDropInput): boolean {
    if (!input.insideDropzone) {
        return false;
    }
    return input.types.some(type => type === MATERIAL_DRAG_MIME || type === LIBRARY_DRAG_MIME);
}
