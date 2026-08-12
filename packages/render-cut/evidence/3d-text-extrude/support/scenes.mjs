// texts[] extrude モードの evidence 群が共有するシーン定義（副作用なし）。
import { FONT_RELATIVE_PATH } from "./fixtures.mjs";

// 静止（anim:none）の正面向き。「立体テロップ」は「ロ」（穴）「プ」（半濁点リング）を含む —
// グリフ正当性ゴールデン（正面・穴が抜けている）に使う
export function frontScene() {
  return {
    texts: [{
      id: "title",
      text: "立体テロップ",
      font: FONT_RELATIVE_PATH,
      mode: "extrude",
      size: 0.85,
      color: "#ffd166",
      material: { metalness: 0.9, roughness: 0.25 },
      extrude: { depth: 0.3, bevelSize: 0.028, bevelThickness: 0.04 },
      layout: { type: "line", spacing: 0.92, position: [0, 0, 0], rotation: [0, 0, 0] },
      anim: { preset: "none" },
    }],
    camera: { position: [0, 0, 5.6], fov: 45, lookAt: [0, 0, 0] },
  };
}

// carousel（テキストブロック全体が Y 軸回転）の「立体テロップ」。determinism-seek.mjs（決定論・
// シーク安全）と golden.mjs（回転中の側面厚み・裏面鏡文字）が共有する。speed=1.5 は
// 24 フレーム/2.4秒の可視区間内で「側面厚みが見える角度（frame 6, ~0.9rad）」と
// 「裏面鏡文字（frame 23 終端, ~3.45rad ≈ 197.7°）」の両方を通るよう選んだ実測値
// （lab/telop-3d-poc の B1 シーンと同じ回転軸・同じ光源値を継承）
export function carouselScene() {
  return {
    texts: [{
      id: "title",
      text: "立体テロップ",
      font: FONT_RELATIVE_PATH,
      mode: "extrude",
      size: 0.85,
      color: "#ffd166",
      material: { metalness: 0.9, roughness: 0.25 },
      extrude: { depth: 0.3, bevelSize: 0.028, bevelThickness: 0.04 },
      layout: { type: "line", spacing: 0.92, position: [0, 0, 0], rotation: [0, 0, 0] },
      anim: { preset: "carousel", speed: 1.5, seed: 7 },
    }],
    camera: { position: [0, 0, 5.6], fov: 45, lookAt: [0, 0, 0] },
  };
}
