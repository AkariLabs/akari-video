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

// 「細い collider」= 床から浮かせた狭い台（polygon の flat-top platform）。x ∈ [-0.7, 0.7] と
// spawn 幅（x ±0.5）にほぼ合わせた狭さで、旧 5 レーン固定グリッド（laneCount=5,
// x=(col-2)*1.1+jitter、列は x=±2.2/±1.1/0 に固定）ではそもそも列 0/4 が台の外側に固定される
// ため乗せられない（社内実測: 頭幅 ±0.9 の帯へ seed を 242 通り全数探索しても 1 文字も乗らな
// かった）。circle ではなく flat-top にしているのは、丸みで滑って台の外へ逃げるのを避けるため
const SPAWN_TARGET_PLATFORM_POINTS = [[-0.7, -0.5], [0.7, -0.5], [0.7, -3.0], [-0.7, -3.0]];

// physics.spawn を宣言したシーン（task 2026-08-14-3d-physics-spawn の spawn 決定論・狙い smoke
// 共通）。狭い spawn 矩形（x ±0.5）を、上記の細い台の直上へ宣言する。floor はさらに下
// （y=-5.0）に安全網として置く — spawn の狙いが外れた場合は「ずっと落下し続ける」のではなく
// floor 付近まで落ち切るので、着地失敗を数値で判別しやすい
export function spawnAimScene({
  text = "着地点",
  seed = 5,
  duration = 3.0,
  dt = 1 / 120,
  restitution = 0.15,
} = {}) {
  return {
    texts: [textEntry("fall", text, { size: 0.32 })],
    physics: {
      enabled: true,
      seed,
      duration,
      dt,
      gravity: [0, -1],
      restitution,
      targets: ["fall"],
      spawn: { x: [-0.5, 0.5], y: [1.0, 1.6] },
      colliders: [
        { type: "floor", y: -5.0 },
        { type: "polygon", points: SPAWN_TARGET_PLATFORM_POINTS },
      ],
    },
    camera: CAMERA,
    lights: LIGHTS,
  };
}

export { SPAWN_TARGET_PLATFORM_POINTS };

export { PERSON_SILHOUETTE_POINTS };
