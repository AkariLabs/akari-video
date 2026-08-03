// ATF モジュールの re-export
export type {
  Value,
  Variable,
  Ease,
  Key,
  Timing,
  Track,
  PerChar,
  EffectPhase,
  EffectPerChar,
  Effect,
  TextContent,
  ShapeContent,
  AtfLayer,
  Stage,
  AtfDoc,
  ResolvedTextContent,
  ResolvedShapeContent,
  ResolvedLayer,
  ResolvedScene,
} from './types'
export type { MeasureText } from './measure'
export { canvasMeasure } from './measure'
export { evalExpr, evalExprWithHas } from './expr'
export { resolve } from './resolve'
export { parseTextRuns, isEmphasizedAt } from './text-runs'
export type { TextRun, ParsedTextRuns } from './text-runs'
export { addOrUpdateKey, getOrCreateTrack } from './tracks'
