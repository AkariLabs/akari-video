// ATF canvas 用 textanim 語彙。
// id / slot の正本は presets/textanim/index.jsonl。ここでは render-cut の CSS レシピを
// opacity / translate / scale / rotate の数値トラックへ写像する。

const EM = 96

const key = (at, value) => ({ at, value })
const track = (prop, ...keys) => ({ prop, keys })

export const TEXTANIM_RECIPES = Object.freeze({
  // フェード
  "fade-in-out": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1))] },
  "soft-fade": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("scale", key(0, 1.04), key(1, 1))] },
  "fade-up": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, 0.6 * EM), key(1, 0))] },
  "fade-down": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, -0.6 * EM), key(1, 0))] },
  "cinematic-fade": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("scale", key(0, 0.94), key(1, 1))] },

  // スライド
  "slide-left": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("x", key(0, 1.2 * EM), key(1, 0))] },
  "slide-right": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("x", key(0, -1.2 * EM), key(1, 0))] },
  "slide-up": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, 1.2 * EM), key(1, 0))] },
  "slide-down": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, -1.2 * EM), key(1, 0))] },
  "push-left": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("x", key(0, 2 * EM), key(1, 0))] },
  "push-right": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("x", key(0, -2 * EM), key(1, 0))] },
  "push-up": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, 1.4 * EM), key(1, 0))] },
  "push-down": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, -1.4 * EM), key(1, 0))] },
  "rise-soft": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, 0.35 * EM), key(1, 0)), track("scale", key(0, 0.98), key(1, 1))] },
  "drop-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.7, 1), key(1, 1)), track("y", key(0, -1.6 * EM), key(0.7, 0.12 * EM), key(1, 0))] },

  // ズーム
  "zoom-in-out": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("scale", key(0, 0.6), key(1, 1))] },
  "zoom-pop": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.7, 1), key(1, 1)), track("scale", key(0, 0.4), key(0.7, 1.12), key(1, 1))] },
  "zoom-pulse": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.55, 1), key(1, 1)), track("scale", key(0, 0.7), key(0.55, 1.06), key(1, 1))] },

  // 弾性
  "pop": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.65, 1), key(1, 1)), track("scale", key(0, 0.5), key(0.65, 1.18), key(1, 1))] },
  "bounce": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.55, 1), key(1, 1)), track("y", key(0, -1.2 * EM), key(0.55, 0.22 * EM), key(0.75, -0.1 * EM), key(1, 0))] },
  "squash-pop": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.6, 1), key(1, 1)), track("scaleX", key(0, 1.4), key(0.6, 0.92), key(1, 1)), track("scaleY", key(0, 0.4), key(0.6, 1.1), key(1, 1))] },
  "stretch-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.7, 1), key(1, 1)), track("scaleX", key(0, 0.2), key(0.7, 1.08), key(1, 1))] },
  "stomp": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.6, 1), key(1, 1)), track("scale", key(0, 1.9), key(0.6, 0.96), key(1, 1))] },
  "snap": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.7, 1), key(1, 1)), track("rotation", key(0, -6), key(0.7, 2), key(1, 0)), track("scale", key(0, 0.8), key(0.7, 1.04), key(1, 1))] },

  // 回転
  "rotate-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("rotation", key(0, -12), key(1, 0)), track("scale", key(0, 0.9), key(1, 1))] },
  "spin-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("rotation", key(0, -180), key(1, 0)), track("scale", key(0, 0.5), key(1, 1))] },
  "roll-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("x", key(0, -2 * EM), key(1, 0)), track("rotation", key(0, -120), key(1, 0))] },
  "spiral-in": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("rotation", key(0, 240), key(1, 0)), track("scale", key(0, 0.2), key(1, 1))] },
  "swing": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.6, 1), key(1, 1)), track("rotation", key(0, 14), key(0.6, -6), key(1, 0))] },

  // 強調
  "shake": { slot: "in", tracks: [track("x", key(0, 0), key(0.2, -0.16 * EM), key(0.4, 0.14 * EM), key(0.6, -0.1 * EM), key(0.8, 0.06 * EM), key(1, 0))] },
  "jitter": { slot: "in", tracks: [track("x", key(0, 0), key(0.25, 0.05 * EM), key(0.5, -0.05 * EM), key(0.75, 0.03 * EM), key(1, 0)), track("y", key(0, 0), key(0.25, -0.04 * EM), key(0.5, 0.04 * EM), key(0.75, 0.05 * EM), key(1, 0))] },
  "glitch": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.3, 1), key(1, 1)), track("x", key(0, -0.2 * EM), key(0.3, 0.12 * EM), key(0.6, -0.06 * EM), key(1, 0))] },
  "flash": { slot: "in", tracks: [track("opacity", key(0, 0), key(0.3, 1), key(0.45, 0.2), key(0.6, 1), key(0.75, 0.5), key(1, 1))] },
  "heartbeat": { slot: "in", tracks: [track("scale", key(0, 1), key(0.25, 1.12), key(0.45, 1), key(0.65, 1.08), key(1, 1))] },

  // 文字表示（Canvas 全レイヤー合成では scaleX によるブロック近似）
  "typewriter": { slot: "in", tracks: [track("scaleX", key(0, 0.001), key(1, 1))] },
  "wipe-left": { slot: "in", tracks: [track("scaleX", key(0, 0.001), key(1, 1)), track("x", key(0, 0.5 * EM), key(1, 0))] },
  "wipe-right": { slot: "in", tracks: [track("scaleX", key(0, 0.001), key(1, 1)), track("x", key(0, -0.5 * EM), key(1, 0))] },

  // ループ
  "wobble": { slot: "loop", tracks: [track("rotation", key(0, -1.6), key(0.5, 1.6), key(1, -1.6))] },
  "float": { slot: "loop", tracks: [track("y", key(0, 0), key(0.5, -0.22 * EM), key(1, 0))] },
  "breath": { slot: "loop", tracks: [track("scale", key(0, 1), key(0.5, 1.03), key(1, 1)), track("opacity", key(0, 1), key(0.5, 0.92), key(1, 1))] },
  "neon-flicker": { slot: "loop", tracks: [track("opacity", key(0, 1), key(0.08, 0.6), key(0.12, 1), key(0.4, 0.85), key(0.44, 1), key(0.7, 0.4), key(0.74, 1), key(1, 1))] },
  "hologram": { slot: "loop", tracks: [track("opacity", key(0, 1), key(0.3, 0.75), key(0.6, 0.9), key(1, 1)), track("x", key(0, 0), key(0.3, 0.03 * EM), key(0.6, -0.03 * EM), key(1, 0))] },
  "retro-flicker": { slot: "loop", tracks: [track("opacity", key(0, 1), key(0.25, 0.7), key(0.5, 1), key(0.75, 0.8), key(1, 1))] },

  // テロップ
  "caption-rise": { slot: "in", tracks: [track("opacity", key(0, 0), key(1, 1)), track("y", key(0, 0.5 * EM), key(1, 0))] },
  "news-ticker": { slot: "loop", tracks: [track("x", key(0, { stage: "width", factor: 1 }), key(1, { stage: "width", factor: -1 }))] },
  "marquee-left": { slot: "loop", tracks: [track("x", key(0, { stage: "width", factor: 1 }), key(1, { stage: "width", factor: -1 }))] },
  "crawl-up": { slot: "loop", tracks: [track("y", key(0, { stage: "height", factor: 1 }), key(1, { stage: "height", factor: -1 }))] },
})

export const TEXTANIM_RECIPE_SLOTS = Object.freeze(Object.fromEntries(
  Object.entries(TEXTANIM_RECIPES).map(([id, recipe]) => [id, recipe.slot]),
))

const reverseEase = (ease) => {
  if (ease === "out-cubic") return "in-cubic"
  if (ease === "in-cubic") return "out-cubic"
  return ease
}

const numericValue = (value, stage) => {
  if (typeof value === "number") return value
  return Number(stage[value.stage]) * value.factor
}

/**
 * 正規化レシピを ATF Track[] に変換する。out は in の厳密な時間反転。
 * opacity はレイヤー固有の基準 opacity に乗算し、hold の既定見た目を保つ。
 */
export function buildTextAnimationTracks(id, phase, duration, baseOpacity, stage) {
  const recipe = TEXTANIM_RECIPES[id]
  if (!recipe) return []
  const reverse = phase === "out"
  return recipe.tracks.map((source) => {
    const authored = source.keys.map((item, index) => ({
      t: item.at * duration,
      v: numericValue(item.value, stage),
      ...(index < source.keys.length - 1 ? { ease: recipe.slot === "loop" ? "linear" : "out-cubic" } : {}),
    }))
    const keys = reverse
      ? authored.slice().reverse().map((item, index, reversed) => ({
          t: duration - item.t,
          v: item.v,
          ...(index < reversed.length - 1
            ? { ease: reverseEase(authored[authored.length - 2 - index]?.ease ?? "linear") }
            : {}),
        }))
      : authored
    return {
      prop: source.prop,
      phase,
      keys: keys.map((item) => source.prop === "opacity" ? { ...item, v: item.v * baseOpacity } : item),
    }
  })
}
