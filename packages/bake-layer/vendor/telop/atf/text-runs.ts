/** 解決済みテキスト内の連続したスタイル範囲。start/end は UTF-16 code unit offset。 */
export interface TextRun {
  start: number
  end: number
  emphasis: boolean
}

export interface ParsedTextRuns {
  text: string
  runs: TextRun[]
  /** 対になったマーカーを 1 組以上除去したとき true。 */
  parsed: boolean
}

/**
 * `**…**` を強調ランへ変換する。
 *
 * v1 契約どおり、マーカーは先頭から順に対にし、閉じ忘れ（奇数個）の入力は
 * fail-visible として一切変換しない。ネスト・エスケープ構文は持たない。
 */
export function parseTextRuns(source: string): ParsedTextRuns {
  const markerOffsets: number[] = []
  for (let at = source.indexOf('**'); at >= 0; at = source.indexOf('**', at + 2)) {
    markerOffsets.push(at)
  }
  if (markerOffsets.length === 0 || markerOffsets.length % 2 !== 0) {
    return {
      text: source,
      runs: source.length > 0 ? [{ start: 0, end: source.length, emphasis: false }] : [],
      parsed: false,
    }
  }

  let text = ''
  let sourceAt = 0
  let emphasis = false
  const runs: TextRun[] = []

  for (const markerAt of markerOffsets) {
    const chunk = source.slice(sourceAt, markerAt)
    const start = text.length
    text += chunk
    if (chunk.length > 0) runs.push({ start, end: text.length, emphasis })
    emphasis = !emphasis
    sourceAt = markerAt + 2
  }

  const tailStart = text.length
  text += source.slice(sourceAt)
  if (text.length > tailStart) runs.push({ start: tailStart, end: text.length, emphasis })

  return { text, runs, parsed: true }
}

/** code unit offset が強調ラン内なら true。 */
export function isEmphasizedAt(runs: TextRun[] | undefined, offset: number): boolean {
  if (!runs) return false
  return runs.some((run) => run.emphasis && offset >= run.start && offset < run.end)
}
