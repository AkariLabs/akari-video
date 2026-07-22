// 縦書き（縦組み）レイアウト計算。resolve（サイズ測定）と canvas2d（描画）で共有し、
// 両者が同じ字送り・列送りで一致するようにする。
//
// レイアウト方針（native drawVerticalText と同等）:
//   - \n が列区切り。各列は上→下に文字を積む。
//   - 列は右→左に並べる（列 0 が右端）。
//   - 字送り（縦方向）= fontSize + letterSpacing
//   - 列送り（横方向）= fontSize × VERTICAL_COLUMN_FACTOR

/** 列送り（列幅）の fontSize 倍率。ATF TextContent に lineHeight が無いため固定値を使う */
export const VERTICAL_COLUMN_FACTOR = 1.2

/** 書記素単位に分割する（結合文字・絵文字を 1 グリフ扱い）。Segmenter 非対応環境は code point fallback */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (seg) => seg.segment,
    )
  }
  return Array.from(text)
}

export interface VerticalMetrics {
  /** 列ごとの書記素配列（columns[i] = 列 i の文字列） */
  columns: string[][]
  /** 字送り（上→下、px） */
  charStep: number
  /** 列送り（右→左、px） */
  colStep: number
  /** 最長列の文字数 */
  maxChars: number
  /** ブロック幅（px、stroke 含まない） */
  width: number
  /** ブロック高さ（px、stroke 含まない） */
  height: number
}

/** 縦書きブロックの寸法とグリフ配置に必要な値を計算する */
export function verticalLayout(text: string, size: number, letterSpacing: number): VerticalMetrics {
  const columns = text.split('\n').map(splitGraphemes)
  const maxChars = Math.max(1, ...columns.map((c) => c.length))
  const charStep = size + Math.max(0, letterSpacing)
  const colStep = size * VERTICAL_COLUMN_FACTOR
  return {
    columns,
    charStep,
    colStep,
    maxChars,
    width: columns.length * colStep,
    height: maxChars * charStep,
  }
}
