// demo-bgm 断片の確認用レンダラ（Windows 版・スクラッチ）。
// 内部リポ harness/render-fragment.mjs と同じ入れ子
// （.akari-overlay-container[inset:0] > .scene-content[inset:0] > 断片）とモーション語彙を敷き、
// (1) 容器に活性ゲート data-akari-active を立てる（プレビュー・書き出しと同じ）、
// (2) --mode export では render-cut/src/rasterize.mjs と同じ「CSS animation → paused WAAPI クローン
//     （delay に start を足す）」へ置き換えてから合成時刻で seek する、
// (3) 背景に本編（スマホ入り）の該当フレームを敷く、
// (4) --scale 0.5 でステージを CSS 縮小（アプリのプレビュー枠 640px と同じ描かれ方）、
// (5) --measure で札の DOM 矩形を JSON に出す。
// 1 回の起動で複数時刻を撮る（harness/render-fragment-sequence.mjs と同じ「ブラウザ 1 回」の流儀）。
//
// 使い方:
//   node render-bgm.mjs <fragment.html> <outDir> --start 29.4333 --times 0,0.05,... \
//     [--mode preview|export] [--bgdir <f<frame>.png のある dir>] [--fps 30] [--scale 1|0.5]
//     [--prefix name] [--transparent] [--frames 883-987]（合成フレームの範囲を全部撮る） [--measure]
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WT = process.env.AKARI_WT || "<WORKTREE>";
const require = createRequire(`${WT}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const CHROME = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`;

const [fragmentPath, outDir] = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const start = Number(arg("--start", "0"));
const fps = Number(arg("--fps", "30"));
let times = arg("--times", "0").split(",").map(Number);
const frames = arg("--frames", null);
if (frames) {
  const [a, b] = frames.split("-").map(Number);
  times = [];
  for (let f = a; f <= b; f++) times.push(Number(((f / fps) - start).toFixed(6)));
}
const mode = arg("--mode", "preview");
const bgdir = arg("--bgdir", null);
const prefix = arg("--prefix", mode);
const vars = arg("--vars", "");
const scale = Number(arg("--scale", "1"));
const transparent = process.argv.includes("--transparent");
const measure = process.argv.includes("--measure");
const W = 1280, H = 720;
const vw = Math.round(W * scale), vh = Math.round(H * scale);
mkdirSync(outDir, { recursive: true });

const fragment = readFileSync(fragmentPath, "utf8");
const motionVocabCss = readFileSync(`${WT}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${transparent ? "transparent" : "#151515"}; }
  #view { position: relative; width: ${vw}px; height: ${vh}px; overflow: hidden; }
  #stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; transform: scale(${scale}); transform-origin: 0 0; }
  #bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .akari-overlay-container { position: absolute; inset: 0; pointer-events: none;
    transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));
    transform-origin: center; ${vars} }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style><style>${motionVocabCss}</style></head><body>
  <div id="view"><div id="stage">${transparent ? "" : '<img id="bg" alt="">'}<div class="akari-overlay-container" data-start="${start}" style="--x:0px;--y:0px;--scale:1;--rotate:0deg"><div class="scene-content">${fragment}</div></div></div></div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  pipe: true,
  args: ["--no-sandbox", "--allow-file-access-from-files", "--force-color-profile=srgb",
    "--disable-lcd-text", "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const report = [];
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  const harnessPath = resolve(outDir, `.${prefix}.harness.html`);
  writeFileSync(harnessPath, page);
  await tab.goto(pathToFileURL(harnessPath).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const fontsLoaded = await tab.evaluate(() => [...document.fonts].map((f) => `${f.family}:${f.status}`));
  const setup = await tab.evaluate((mode) => {
    const container = document.querySelector(".akari-overlay-container");
    if (mode === "export") {
      const startMs = Number(container.dataset.start) * 1000;
      container.toggleAttribute("data-akari-active", true);
      const conversions = [];
      for (const animation of container.getAnimations({ subtree: true })) {
        if (!(animation instanceof CSSAnimation)) continue;
        const effect = animation.effect;
        conversions.push({ target: effect.target, keyframes: effect.getKeyframes(), timing: effect.getTiming(),
          pseudoElement: effect.pseudoElement || null, animation, name: animation.animationName });
      }
      for (const c of conversions) {
        if (c.pseudoElement) c.animation.cancel(); else c.target.style.animationName = "none";
      }
      const failed = [];
      let cloned = 0;
      for (const c of conversions) {
        const t = c.timing;
        try {
          const clone = c.target.animate(c.keyframes, {
            delay: (Number(t.delay) || 0) + startMs, endDelay: t.endDelay, duration: t.duration,
            iterations: t.iterations, iterationStart: t.iterationStart, direction: t.direction,
            easing: t.easing, fill: t.fill, ...(c.pseudoElement ? { pseudoElement: c.pseudoElement } : {}),
          });
          clone.pause();
          clone.currentTime = 0;
          cloned += 1;
        } catch (error) {
          failed.push(`${c.name}: ${error.message}`);
        }
      }
      return { conversions: conversions.length, cloned, failed };
    }
    container.toggleAttribute("data-akari-active", true);
    return { animations: container.getAnimations({ subtree: true }).length };
  }, mode);
  report.push({ setup, fontsLoaded });
  for (const local of times) {
    const composition = start + local;
    if (bgdir && !transparent) {
      const frame = Math.round(composition * fps);
      const bgPath = resolve(bgdir, `f${frame}.png`);
      if (existsSync(bgPath)) {
        await tab.evaluate(async (src) => {
          const img = document.getElementById("bg");
          if (img.src !== src) { img.src = src; await img.decode().catch(() => {}); }
        }, pathToFileURL(bgPath).href);
      }
    }
    const info = await tab.evaluate((mode, local, composition, measure) => {
      const container = document.querySelector(".akari-overlay-container");
      const ms = (mode === "export" ? composition : local) * 1000;
      const animations = container.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = ms;
      }
      const out = { animations: animations.length };
      if (measure) {
        const stage = document.getElementById("stage").getBoundingClientRect();
        const s = stage.width / 1280;
        const r = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return [b.left - stage.left, b.top - stage.top, b.right - stage.left, b.bottom - stage.top].map((v) => Number((v / s).toFixed(1)));
        };
        out.rects = { chip: r(".demo-bgm__chip"), label: r(".demo-bgm__label"), note: r(".demo-bgm__note"), eq: r(".demo-bgm__eq") };
        const chip = document.querySelector(".demo-bgm__chip");
        out.chipOpacity = Number(getComputedStyle(chip).opacity);
        const label = document.querySelector(".demo-bgm__label");
        out.labelFontSize = getComputedStyle(label).fontSize;
        out.labelFamilyUsed = getComputedStyle(label).fontFamily;
        out.labelInk = (() => { const range = document.createRange(); range.selectNodeContents(label); const b = range.getBoundingClientRect(); return [b.width / s, b.height / s].map((v) => Number(v.toFixed(1))); })();
      }
      return out;
    }, mode, local, composition, measure);
    await new Promise((r) => setTimeout(r, 40));
    const name = `${prefix}-t${local.toFixed(3)}.png`;
    writeFileSync(resolve(outDir, name), await tab.screenshot({ omitBackground: transparent }));
    report.push({ local: Number(local.toFixed(4)), composition: Number(composition.toFixed(4)), frame: Math.round(composition * fps), ...info, out: name });
  }
  try { unlinkSync(harnessPath); } catch {}
} finally {
  const proc = browser.process();
  if (proc) proc.kill("SIGKILL"); else await browser.close();
}
writeFileSync(resolve(outDir, `${prefix}-report.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.slice(0, 3)));
