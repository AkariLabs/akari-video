// physics 検証ハーネスの副作用なしシーン定義（3d-text-flat/lib/scenes.mjs 相当）
import { FONT_RELATIVE_PATH } from "./fixtures.mjs";

const CAMERA = { position: [0, 0, 8.2], fov: 45, near: 0.1, far: 100, lookAt: [0, 0, 0] };
const LIGHTS = [
  { type: "ambient", color: "#ffffff", intensity: 0.5 },
  { type: "directional", color: "#ffffff", position: [2, 4, 3], lookAt: [0, 0, 0], intensity: 1.1 },
];

function textEntry(id, text, overrides = {}) {
  return {
    id,
    text,
    font: FONT_RELATIVE_PATH,
    mode: "flat",
    size: 0.55,
    color: "#ffd166",
    material: { doubleSide: true },
    layout: { type: "line", spacing: 0.7 },
    ...overrides,
  };
}

// 床 + 左右の壁 + 円柱（人物頭部の代役）へ文字を落とす基本シーン。
// 決定論・シーク安全・ネットワークゼロ・restitution smoke で共有する
export function basicFallScene({
  text = "アカリビデオ物理",
  seed = 7,
  duration = 2.4,
  dt = 1 / 120,
  restitution = 0.45,
  gravity = [0, -1],
} = {}) {
  return {
    texts: [textEntry("fall", text)],
    physics: {
      enabled: true,
      seed,
      duration,
      dt,
      gravity,
      restitution,
      targets: ["fall"],
      colliders: [
        { type: "floor", y: -2.6 },
        { type: "wall", x: 5.6 },
        { type: "wall", x: -5.6 },
        { type: "circle", center: [1.7, -0.05], r: 0.62 },
      ],
    },
    camera: CAMERA,
    lights: LIGHTS,
  };
}

// 腕と胴体の間に凹みのある人型 polygon collider（34 頂点。T5 spike の実測レンジ 25〜60 に収まる）。
// arms-akimbo のポーズで、肩から手までを外側へ出し、脇（armpit）で胴体側へ大きく凹ませることで
// 凸包に潰すと消える「腕の隙間」を作る。頭上から見て左右対称
const PERSON_SILHOUETTE_POINTS = [
  [0.0, 2.3], [0.55, 2.15], [0.62, 1.75], [0.42, 1.55],
  [1.15, 1.35], [1.75, 0.55], [1.95, -0.35], [1.55, -0.45],
  [1.15, 0.35], [0.6, 0.85], [0.55, -0.05], [0.62, -0.95],
  [1.05, -1.35], [1.15, -2.55], [0.95, -2.6], [0.55, -2.55],
  [0.45, -1.65], [0.0, -1.45], [-0.45, -1.65], [-0.55, -2.55],
  [-0.95, -2.6], [-1.15, -2.55], [-1.05, -1.35], [-0.62, -0.95],
  [-0.55, -0.05], [-0.6, 0.85], [-1.15, 0.35], [-1.55, -0.45],
  [-1.95, -0.35], [-1.75, 0.55], [-1.15, 1.35], [-0.42, 1.55],
  [-0.62, 1.75], [-0.55, 2.15],
];

export function personSilhouetteScene({
  text = "テキスト物理落下テスト",
  seed = 11,
  duration = 6.0,
  dt = 1 / 120,
  restitution = 0.35,
} = {}) {
  return {
    texts: [textEntry("fall", text, { size: 0.42 })],
    physics: {
      enabled: true,
      seed,
      duration,
      dt,
      gravity: [0, -1],
      restitution,
      targets: ["fall"],
      colliders: [
        { type: "floor", y: -2.6 },
        { type: "wall", x: 5.6 },
        { type: "wall", x: -5.6 },
        { type: "polygon", points: PERSON_SILHOUETTE_POINTS },
      ],
    },
    camera: CAMERA,
    lights: LIGHTS,
  };
}

export { PERSON_SILHOUETTE_POINTS };
