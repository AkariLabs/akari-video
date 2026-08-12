// texts[] flat モードの evidence 群が共有するシーン定義（副作用なし）。
import { FONT_RELATIVE_PATH } from "./fixtures.mjs";

// cylinder レイアウト + carousel プリセットの「アカリビデオ」筒テロップ。
// determinism-seek.mjs（決定論・シーク安全）と golden.mjs（裏面鏡文字ゴールデン）が共有する
export function cylinderScene() {
  return {
    texts: [{
      id: "ring",
      text: "アカリビデオ・AKARI VIDEO・",
      font: FONT_RELATIVE_PATH,
      mode: "flat",
      size: 0.32,
      color: "#f5f1e8",
      material: { doubleSide: true },
      layout: { type: "cylinder", radius: 2.2, position: [0, 0.2, 0], rotation: [0, 0, 0] },
      anim: { preset: "carousel", speed: 0.5, stagger: 0.05, amplitude: 1, seed: 7 },
    }],
    camera: { position: [0, 0.4, 6.2], fov: 45, lookAt: [0, 0, 0] },
  };
}

// 静止（anim:none）の line レイアウト。「立体テロップ」は「ロ」（穴）「プ」（半濁点リング）を
// 含む — グリフ正当性ゴールデンに使う
export function roProScene() {
  return {
    texts: [{
      id: "ro-pu",
      text: "立体テロップ",
      font: FONT_RELATIVE_PATH,
      mode: "flat",
      size: 0.85,
      color: "#ffd166",
      material: { doubleSide: true },
      layout: { type: "line", spacing: 0.92, position: [0, 0, 0], rotation: [0, 0, 0] },
      anim: { preset: "none" },
    }],
    camera: { position: [0, 0, 5.6], fov: 45, lookAt: [0, 0, 0] },
  };
}
