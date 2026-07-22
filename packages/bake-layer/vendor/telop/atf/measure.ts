// テキスト実測ユーティリティ
// Canvas 2D API を使って文字列の実際の幅/高さを計測する

/** テキスト実測関数の型 */
export type MeasureText = (text: string, font: string, sizePx: number, weight?: number) => { width: number; height: number }

/**
 * Canvas 2D を使ったテキスト実測
 * SSR / テスト環境では近似値にフォールバックする
 */
export const canvasMeasure: MeasureText = (text: string, font: string, sizePx: number, weight?: number): { width: number; height: number } => {
  // Canvas context の取得を試みる
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null

  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1)
      ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      ctx = canvas.getContext('2d')
    }
  } catch {
    ctx = null
  }

  if (!ctx) {
    // フォールバック: 文字数 × sizePx × 0.6 の近似
    return {
      width: text.length * sizePx * 0.6,
      height: sizePx * 1.2,
    }
  }

  // フォント設定して実測
  const fontStr = weight ? `${weight} ${sizePx}px ${font}` : `${sizePx}px ${font}`
  ctx.font = fontStr
  const metrics = ctx.measureText(text)
  return {
    width: metrics.width,
    height: sizePx * 1.2,
  }
}
