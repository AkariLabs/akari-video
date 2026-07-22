import type { AtfLayer, Track } from './types'

const DEFAULT_EPS = 1e-3

export interface TrackResult {
  layer: AtfLayer
  track: Track
  index: number
}

/**
 * 同時刻近傍の key は更新し、なければ時刻順に追加する。
 */
export function addOrUpdateKey(track: Track, t: number, v: number, eps = DEFAULT_EPS): Track {
  const nextKey = { t, v }
  const hitIndex = track.keys.findIndex((key) => Math.abs(key.t - t) <= eps)

  if (hitIndex >= 0) {
    const keys = track.keys.map((key, index) => (
      index === hitIndex ? { ...key, ...nextKey } : { ...key }
    ))
    keys.sort((a, b) => a.t - b.t)
    return { ...track, keys }
  }

  const keys = [...track.keys.map((key) => ({ ...key })), nextKey]
  keys.sort((a, b) => a.t - b.t)
  return { ...track, keys }
}

/**
 * レイヤーから指定 prop/phase の track を取得し、なければ作成する。
 */
export function getOrCreateTrack(
  layer: AtfLayer,
  prop: Track['prop'],
  phase: Track['phase'] = 'hold',
): TrackResult {
  const tracks = layer.tracks ?? []
  const index = tracks.findIndex((track) => track.prop === prop && (track.phase ?? 'hold') === phase)

  if (index >= 0) {
    const nextTracks = tracks.map((track) => ({ ...track, keys: track.keys.map((key) => ({ ...key })) }))
    return {
      layer: { ...layer, tracks: nextTracks },
      track: nextTracks[index],
      index,
    }
  }

  const track: Track = { prop, phase, keys: [] }
  const nextTracks = [...tracks.map((item) => ({ ...item, keys: item.keys.map((key) => ({ ...key })) })), track]
  return {
    layer: { ...layer, tracks: nextTracks },
    track,
    index: nextTracks.length - 1,
  }
}
