import type { ResolvedLayer, Timing } from '../atf/types'
import { sampleTrackInPhase, trackPhaseHasStarted } from './timing'

const DEFAULT_PERSPECTIVE = 1000

export interface SampledLayerTransform {
  x: number
  y: number
  scale: number
  scaleX: number
  scaleY: number
  rotation: number
  skewX: number
  skewY: number
  originX: number
  originY: number
  rotateX: number
  rotateY: number
  perspectiveZ: number
  opacity: number
  blur: number
  /** ワイプ表示割合（0..1）。wipe track がある場合のみ使う */
  wipe?: number
  /** 字間（px）。letterSpacing track がある場合のみ使う */
  letterSpacing?: number
  /** フォントウェイト（100..900）。weight track がある場合のみ使う */
  weight?: number
  /** カウンター進行（0..1）。counter track がある場合のみ使う */
  counter?: number
}

export interface LayerLocalPoint {
  x: number
  y: number
}

export interface LayerTransformMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function perspectiveScale(z: number): number {
  if (z === 0) return 1
  const denom = DEFAULT_PERSPECTIVE - z
  if (Math.abs(denom) < 1e-6) {
    return DEFAULT_PERSPECTIVE / (denom < 0 ? -1e-6 : 1e-6)
  }
  return DEFAULT_PERSPECTIVE / denom
}

function applyPseudo3DApproximation(transform: SampledLayerTransform): SampledLayerTransform {
  // Canvas2D には真の 3D 変換がないため、rotateX/Y は cos 投影で各軸 scale に落とす。
  // cos が負になる角度は裏面相当として符号を残し、mirror flip として近似する。
  const rotateXCos = Math.cos(degToRad(transform.rotateX))
  const rotateYCos = Math.cos(degToRad(transform.rotateY))

  // perspectiveZ は translateZ 相当として扱い、固定視距離から一様 scale に変換する。
  const perspScale = perspectiveScale(transform.perspectiveZ)

  return {
    ...transform,
    scale: transform.scale * perspScale,
    scaleX: transform.scaleX * rotateYCos,
    scaleY: transform.scaleY * rotateXCos,
  }
}

export function layerTransformMatrix(
  transform: SampledLayerTransform,
  w: number,
  h: number,
  anchor: { x: number; y: number },
): LayerTransformMatrix {
  const θ = degToRad(transform.rotation)
  const cosR = Math.cos(θ)
  const sinR = Math.sin(θ)
  const tanSX = Math.tan(degToRad(transform.skewX))
  const tanSY = Math.tan(degToRad(transform.skewY))
  const sx = transform.scale * transform.scaleX
  const sy = transform.scale * transform.scaleY

  const a = (cosR - sinR * tanSY) * sx
  const b = (sinR + cosR * tanSY) * sx
  const c = (-sinR + cosR * tanSX) * sy
  const d = (cosR + sinR * tanSX) * sy
  const originX = transform.originX
  const originY = transform.originY
  const localOriginX = anchor.x * w + originX
  const localOriginY = anchor.y * h + originY

  return {
    a,
    b,
    c,
    d,
    e: transform.x + originX - a * localOriginX - c * localOriginY,
    f: transform.y + originY - b * localOriginX - d * localOriginY,
  }
}

export function sampleLayerTransform(
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
): SampledLayerTransform {
  let x = layer.transform.x
  let y = layer.transform.y
  let scale = 1
  let scaleX = 1
  let scaleY = 1
  let rotation = layer.transform.rotation
  let skewX = layer.transform.skewX ?? 0
  let skewY = layer.transform.skewY ?? 0
  let originX = 0
  let originY = 0
  let rotateX = 0
  let rotateY = 0
  let perspectiveZ = 0
  let opacity = layer.transform.opacity
  let blur = 0
  let wipe: number | undefined
  let letterSpacing: number | undefined
  let weight: number | undefined
  let counter: number | undefined

  if (layer.tracks) {
    for (const track of layer.tracks) {
      if (!trackPhaseHasStarted(track, t, T, timing)) continue
      const value = sampleTrackInPhase(track, t, T, timing)
      switch (track.prop) {
        case 'x':
          x += value
          break
        case 'y':
          y += value
          break
        case 'scale':
          scale = value
          break
        case 'scaleX':
          scaleX = value
          break
        case 'scaleY':
          scaleY = value
          break
        case 'rotation':
          rotation += value
          break
        case 'skewX':
          skewX += value
          break
        case 'skewY':
          skewY += value
          break
        case 'originX':
          originX = value
          break
        case 'originY':
          originY = value
          break
        case 'rotateX':
          rotateX += value
          break
        case 'rotateY':
          rotateY += value
          break
        case 'perspectiveZ':
          perspectiveZ = value
          break
        case 'opacity':
          opacity = value
          break
        case 'blur':
          blur = value
          break
        case 'wipe':
          wipe = Math.max(0, Math.min(1, value))
          break
        case 'letterSpacing':
          letterSpacing = value
          break
        case 'weight':
          weight = value
          break
        case 'counter':
          counter = Math.max(0, Math.min(1, value))
          break
      }
    }
  }

  const result: SampledLayerTransform = applyPseudo3DApproximation({
    x,
    y,
    scale,
    scaleX,
    scaleY,
    rotation,
    skewX,
    skewY,
    originX,
    originY,
    rotateX,
    rotateY,
    perspectiveZ,
    opacity,
    blur,
  })
  if (wipe !== undefined) result.wipe = wipe
  if (letterSpacing !== undefined) result.letterSpacing = letterSpacing
  if (weight !== undefined) result.weight = weight
  if (counter !== undefined) result.counter = counter
  return result
}

export function stagePointToLayerLocal(
  layer: ResolvedLayer,
  pointX: number,
  pointY: number,
  t: number,
  T: number,
  timing: Timing | undefined,
): LayerLocalPoint | null {
  const transform = sampleLayerTransform(layer, t, T, timing)
  if (transform.opacity <= 0) return null

  const matrix = layerTransformMatrix(transform, layer.size.w, layer.size.h, layer.transform.anchor)
  const det = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(det) < 1e-12) return null

  const dx = pointX - matrix.e
  const dy = pointY - matrix.f
  const localX = (matrix.d * dx - matrix.c * dy) / det
  const localY = (-matrix.b * dx + matrix.a * dy) / det

  return { x: localX, y: localY }
}

export function pointInLayerBounds(
  layer: ResolvedLayer,
  pointX: number,
  pointY: number,
  t: number,
  T: number,
  timing: Timing | undefined,
): boolean {
  const local = stagePointToLayerLocal(layer, pointX, pointY, t, T, timing)
  if (!local) return false
  return local.x >= 0 && local.x <= layer.size.w && local.y >= 0 && local.y <= layer.size.h
}
