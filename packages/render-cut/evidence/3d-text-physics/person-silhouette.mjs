// 人物シルエット試験（契約の指示 4・受け入れ条件）。腕と胴の間に凹みのある人型 polygon collider
// （34 頂点。shared/scenes.mjs personSilhouetteScene、T5 spike の実測レンジ 25〜60 に収まる）へ
// 文字を落とし、(a) 文字が輪郭に沿って積もる・凹みに文字が入り込むフレームを目視用に保存し
// (b) 凸包に潰れていないこと（poly-decomp 経由で凹みが保たれること）を実測で確認する
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
  projectPolygonToScreenSvgPoints,
} from "./shared/fixtures.mjs";
import { personSilhouetteScene, PERSON_SILHOUETTE_POINTS } from "./shared/scenes.mjs";

const ARTIFACTS_DIR = join(new URL(".", import.meta.url).pathname, "artifacts");
await mkdir(ARTIFACTS_DIR, { recursive: true });

const edit = editFor({ width: 640, height: 480, fps: 10 });
const DURATION = 6.0;
// 右脇の凹み（腕と胴の間）の scene 座標での目安バウンディングボックス（shared/scenes.mjs
// PERSON_SILHOUETTE_POINTS のインデックス 8〜10 付近）。左右対称なので x を反転すれば左脇にもなる
const RIGHT_NOTCH_BOUNDS = { xMin: 0.5, xMax: 1.25, yMin: -0.15, yMax: 0.95 };

function insideNotch(x, y) {
  const absX = Math.abs(x);
  return absX >= RIGHT_NOTCH_BOUNDS.xMin
    && absX <= RIGHT_NOTCH_BOUNDS.xMax
    && y >= RIGHT_NOTCH_BOUNDS.yMin
    && y <= RIGHT_NOTCH_BOUNDS.yMax;
}

const projectRoot = await makeProjectRoot("person-silhouette");
try {
  const workDir = join(projectRoot, "work");
  await mkdir(workDir, { recursive: true });
  // seed=22 は本ハーネスの探索（_debug-seed-search.mjs、report.md 記載）で見つけた値。
  // t=0.1s に char index 6 が左脇の凹み座標域（x≈-0.82, y≈-0.02）へ入ることを事前確認済み
  const scene = personSilhouetteScene({ duration: DURATION, seed: 22 });
  const overlay = overlayFor("phys", scene, { start: 0, duration: DURATION });
  const sheetPath = join(workDir, "sheet.html");
  // collider の輪郭は本番ランタイムでは非表示（three-runtime.js は手を入れない）。
  // 「どこが notch なのか」を目視できるよう、評価ハーネス専用の SVG ガイドを重ねる
  // （判定には使わない。判定は concavityCheck の数値と insideNotch() 座標判定）
  const svgPoints = projectPolygonToScreenSvgPoints(PERSON_SILHOUETTE_POINTS, {
    width: edit.output.width,
    height: edit.output.height,
  });
  const sheetHtml = renderOverlaySheet({ overlays: [overlay], edit, projectRoot, duration: DURATION }).replace(
    "</body>",
    `<svg width="${edit.output.width}" height="${edit.output.height}" `
      + `style="position:absolute;left:0;top:0;pointer-events:none;">`
      + `<polygon points="${svgPoints}" fill="rgba(120,170,255,0.16)" `
      + `stroke="rgba(140,190,255,0.9)" stroke-width="1.5" /></svg></body>`,
  );
  await writeFile(sheetPath, sheetHtml, "utf8");

  const { browser } = await launchBrowser();
  let concavityCheck;
  const notchFramePath = join(ARTIFACTS_DIR, "person-silhouette-notch.png");
  const notchViewablePath = join(ARTIFACTS_DIR, "person-silhouette-notch-viewable.png");
  const settledFramePath = join(ARTIFACTS_DIR, "person-silhouette-settled.png");
  const settledViewablePath = join(ARTIFACTS_DIR, "person-silhouette-settled-viewable.png");
  let notchFrame = null;
  let settledInspection;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => window.__akariReady);

    // (b) 凸包に潰れていないことの実測: buildColliderBody が実際に作った matter body の
    // parts 数・面積を、bundle 本体（three-runtime.js 経由）から読み出す。凸包なら 1 part・
    // 面積は外接矩形に近い大きな値、poly-decomp が効いていれば複数 part・面積は宣言頂点の
    // 実面積（shoelace）に一致する
    concavityCheck = await page.evaluate((points) => {
      const { Matter } = window.AkariThree;
      const verts = points.map(([x, y]) => ({ x, y }));
      const shoelaceArea = Matter.Vertices.area(verts);
      const centre = Matter.Vertices.centre(verts);
      const body = Matter.Bodies.fromVertices(centre.x, centre.y, [verts], { isStatic: true }, true, 0.01, 0);
      const decomposedPartCount = body.parts.length - 1;
      const decomposedArea = body.parts.slice(1).reduce((sum, part) => sum + part.area, 0);
      return {
        declaredVertexCount: points.length,
        shoelaceArea: Math.abs(shoelaceArea),
        decomposedPartCount,
        decomposedArea,
        // 凸包に潰れていたら part は 1 個・面積は shoelace 実面積よりずっと大きくなるはず
        notCollapsedToHull: decomposedPartCount > 1,
      };
    }, PERSON_SILHOUETTE_POINTS);

    // (a) 目視用フレーム: 落下開始から着地までを細かく走査し、いずれかの char が脇の凹み
    // バウンディングボックスへ入った最初のフレームを実測で選ぶ（憶測の秒数を決め打ちしない）
    for (let step = 0; step <= 60; step += 1) {
      const seconds = step * 0.02; // 0 〜 1.2s を 0.02s 刻み
      const states = await page.evaluate((t) => {
        const container = document.querySelector(".akari-overlay-container > .scene-content");
        window.akari.threeRuntime.render(container, t);
        return window.akari.threeRuntime.inspect(container).physics.charStates;
      }, seconds);
      const hit = states.some((state) => insideNotch(state.x, state.y));
      if (hit) {
        notchFrame = { seconds, states };
        await page.evaluate((t) => window.__akariSeek(t), seconds);
        await page.screenshot({ path: notchFramePath, omitBackground: true });
        break;
      }
    }

    const settledSeconds = DURATION - 0.1; // DURATION ちょうどは overlay の可視区間 [start, start+duration) の外
    await page.evaluate((t) => window.__akariSeek(t), settledSeconds);
    await page.screenshot({ path: settledFramePath, omitBackground: true });
    settledInspection = await page.evaluate(() => {
      const container = document.querySelector(".akari-overlay-container > .scene-content");
      return window.akari.threeRuntime.inspect(container);
    });
  } finally {
    await browser.close();
  }

  if (notchFrame) {
    compositeOverBackground(notchFramePath, notchViewablePath);
  }
  compositeOverBackground(settledFramePath, settledViewablePath);

  const result = {
    generated_at_note: "generated by evidence/3d-text-physics/person-silhouette.mjs",
    scene: "personSilhouetteScene (34-vertex concave humanoid collider, arms-akimbo notches)",
    duration_seconds: DURATION,
    concavityCheck,
    physicsInspect: settledInspection.physics,
    notchBounds: RIGHT_NOTCH_BOUNDS,
    notchFrame: notchFrame
      ? { seconds: notchFrame.seconds, path: "artifacts/person-silhouette-notch.png", charStates: notchFrame.states }
      : null,
    frames: {
      notch: notchFrame ? "artifacts/person-silhouette-notch-viewable.png" : null,
      settled: "artifacts/person-silhouette-settled-viewable.png",
    },
    pass: Boolean(concavityCheck.notCollapsedToHull && notchFrame),
  };

  await writeFile(
    join(ARTIFACTS_DIR, "person-silhouette-result.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}
