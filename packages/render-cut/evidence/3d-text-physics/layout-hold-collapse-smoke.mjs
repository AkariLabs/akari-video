// 崩落 smoke（task 2026-08-14-3d-physics-hold の受け入れ条件）。physics.start="layout" +
// physics.holdSeconds を宣言したシーン（shared/scenes.mjs layoutHoldScene: 横並びでわずかに斜めな
// 読めるテロップ）を使い、(a) hold 中（t=0.5）はレイアウトどおりの配置で静止したまま読めること、
// (b) hold 明け後は落下が始まり、settle 時点で床付近に積もって静止していることを実測する。
// (a) は独立に計算した期待値（charBasePosition と同じ line-layout 式 + layout.rotation.z の
// 2D 回転）と実測 charStates を突き合わせる数値判定。加えて 2 時刻分の PNG を証跡として残す
// （契約の指示「2 フレーム PNG で確認」）。
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderOverlaySheet } from "../../src/rasterize.mjs";
import {
  compositeOverBackground,
  editFor,
  launchBrowser,
  makeProjectRoot,
  overlayFor,
} from "./shared/fixtures.mjs";
import { layoutHoldScene } from "./shared/scenes.mjs";

const ARTIFACTS_DIR = join(new URL(".", import.meta.url).pathname, "artifacts");
await mkdir(ARTIFACTS_DIR, { recursive: true });

const edit = editFor({ width: 480, height: 270, fps: 10 });
const TEXT = "落ちるテスト";
const SPACING = 0.55;
const LAYOUT_POSITION = [0, 1.6, 0];
const ROTATION_Z = 0.22;
const HOLD_SECONDS = 1.0;
const DURATION = 2.5;
const FLOOR_Y = -2.6;
// hold 中はレイアウトどおりの位置に厳密に静止する（isStatic body は Engine.update の影響を
// 受けないので理論上ビット単位で不動）。float32 バッファ経由の丸め誤差ぶんだけ緩める
const READABLE_EPSILON = 1e-3;
// hold 中の 2 時刻間の変位（静止していることの確認。理論上ほぼ 0）
const FROZEN_DISPLACEMENT_EPSILON = 1e-4;
// settle 判定は spawn-aim-smoke.mjs と同じ流儀（2 時刻間の変位が十分小さければ「静止」とみなす）
const SETTLE_EPSILON = 0.01;
// 床からの許容マージン（文字の半サイズ + バウンド残差ぶん）
const FLOOR_MARGIN = 1.0;

// charBasePosition（line layout）と同じ式で「レイアウトどおりの配置」を独立に計算する
function expectedLayoutStates(text, spacing, position, rotationZ) {
  const chars = [...text];
  const count = chars.length;
  const cos = Math.cos(rotationZ);
  const sin = Math.sin(rotationZ);
  return chars.map((_, index) => {
    const localX = (index - (count - 1) / 2) * spacing;
    return { x: position[0] + localX * cos, y: position[1] + localX * sin, angle: rotationZ };
  });
}

const expected = expectedLayoutStates(TEXT, SPACING, LAYOUT_POSITION, ROTATION_Z);

const projectRoot = await makeProjectRoot("layout-hold-collapse-smoke");
try {
  const workDir = join(projectRoot, "work");
  await mkdir(workDir, { recursive: true });
  const scene = layoutHoldScene({
    text: TEXT,
    duration: DURATION,
    holdSeconds: HOLD_SECONDS,
    rotationZ: ROTATION_Z,
  });
  const overlay = overlayFor("phys", scene, { start: 0, duration: DURATION });
  const sheetPath = join(workDir, "sheet.html");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays: [overlay], edit, projectRoot, duration: DURATION }),
    "utf8",
  );

  const { browser } = await launchBrowser();
  const readableFramePath = join(ARTIFACTS_DIR, "layout-hold-collapse-readable.png");
  const readableViewablePath = join(ARTIFACTS_DIR, "layout-hold-collapse-readable-viewable.png");
  const settledFramePath = join(ARTIFACTS_DIR, "layout-hold-collapse-settled.png");
  const settledViewablePath = join(ARTIFACTS_DIR, "layout-hold-collapse-settled-viewable.png");
  let earlyHoldStates;
  let midHoldStates;
  let preSettleStates;
  let settleStates;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => window.__akariReady);

    async function charStatesAt(seconds) {
      await page.evaluate((t) => window.__akariSeek(t), seconds);
      return page.evaluate(() => {
        const container = document.querySelector(".akari-overlay-container > .scene-content");
        return window.akari.threeRuntime.inspect(container).physics.charStates;
      });
    }

    // (a) hold 中: 2 時刻（0.3s, 0.5s。どちらも holdSeconds=1.0 未満）を比較し、静止 + レイアウト
    // どおりであることを確認する
    earlyHoldStates = await charStatesAt(0.3);
    midHoldStates = await charStatesAt(0.5);
    await page.screenshot({ path: readableFramePath, omitBackground: true });

    // (b) hold 明け後: DURATION 直前の 2 時刻（可視区間 [0, DURATION) の内側）を比較し、
    // 落下が終わって静止している（= 床付近に積もっている）ことを確認する
    preSettleStates = await charStatesAt(DURATION - 0.2);
    settleStates = await charStatesAt(DURATION - 0.1);
    await page.screenshot({ path: settledFramePath, omitBackground: true });
  } finally {
    await browser.close();
  }

  compositeOverBackground(readableFramePath, readableViewablePath);
  compositeOverBackground(settledFramePath, settledViewablePath);

  const readablePerChar = midHoldStates.map((state, index) => {
    const early = earlyHoldStates[index];
    const exp = expected[index];
    const frozenDisplacement = Math.hypot(state.x - early.x, state.y - early.y);
    const positionError = Math.hypot(state.x - exp.x, state.y - exp.y);
    const angleError = Math.abs(state.angle - exp.angle);
    return {
      index,
      x: state.x,
      y: state.y,
      angle: state.angle,
      expectedX: exp.x,
      expectedY: exp.y,
      expectedAngle: exp.angle,
      positionError,
      angleError,
      frozenDisplacement,
      matchesLayout: positionError < READABLE_EPSILON && angleError < READABLE_EPSILON,
      frozen: frozenDisplacement < FROZEN_DISPLACEMENT_EPSILON,
    };
  });
  const readablePass = readablePerChar.length === expected.length
    && readablePerChar.every((c) => c.matchesLayout && c.frozen);

  const settledPerChar = settleStates.map((state, index) => {
    const pre = preSettleStates[index];
    const displacement = Math.hypot(state.x - pre.x, state.y - pre.y);
    return {
      index,
      x: state.x,
      y: state.y,
      displacement,
      settled: displacement < SETTLE_EPSILON,
      onFloor: state.y > FLOOR_Y - 0.001 && state.y < FLOOR_Y + FLOOR_MARGIN,
      // hold 中の期待座標より十分低ければ「落ちた」と判定できる（読める配置の y=1.6 近辺から
      // 床 y=-2.6 近辺まで動いたかどうか）
      fellFromLayout: state.y < expected[index].y - 1.0,
    };
  });
  const settledPass = settledPerChar.length === expected.length
    && settledPerChar.every((c) => c.settled && c.onFloor && c.fellFromLayout);

  const result = {
    generated_at_note: "generated by evidence/3d-text-physics/layout-hold-collapse-smoke.mjs",
    scene: `layoutHoldScene (physics.start="layout", physics.holdSeconds=${HOLD_SECONDS}, id=phys, floor+wall*2, ${TEXT})`,
    text: TEXT,
    spacing: SPACING,
    layoutPosition: LAYOUT_POSITION,
    rotationZ: ROTATION_Z,
    holdSeconds: HOLD_SECONDS,
    duration_seconds: DURATION,
    floorY: FLOOR_Y,
    readable: {
      sampledAtSeconds: [0.3, 0.5],
      perChar: readablePerChar,
      pass: readablePass,
      frame: "artifacts/layout-hold-collapse-readable-viewable.png",
    },
    settled: {
      sampledAtSeconds: [DURATION - 0.2, DURATION - 0.1],
      perChar: settledPerChar,
      pass: settledPass,
      frame: "artifacts/layout-hold-collapse-settled-viewable.png",
    },
    pass: readablePass && settledPass,
  };

  await writeFile(
    join(ARTIFACTS_DIR, "layout-hold-collapse-smoke-result.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(
    { readablePass, settledPass, pass: result.pass },
    null,
    2,
  ));
  if (!result.pass) process.exitCode = 1;
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}
