// demo-title 断片の確認用レンダラ（Windows 版）。
// 内部リポ harness/render-fragment.mjs と同じ入れ子
// （.akari-overlay-container[inset:0] > .scene-content[inset:0] > 断片）とモーション語彙を敷き、
// 本機向けに次だけ変えた（harness 本体は Mac のパス固定で本機では動かない）:
//   (1) puppeteer-core は worktree の node_modules、ブラウザは Playwright の chrome-headless-shell
//   (2) 容器に活性ゲート data-akari-active を立てる（プレビューの overlay-runtime・書き出しと同じ）
//   (3) ブラウザを 1 回だけ起動し、--times の各ローカル秒へ WAAPI seek して連続で撮る
//   (4) --bgdir に本編のフレーム f<N>.png（N = round((start + local) × fps)）があれば背景に敷く
//   (5) --mode export は render-cut/src/rasterize.mjs と同じ「CSS animation → start を delay に足した
//       paused WAAPI クローン」へ置き換えてから合成時刻で seek する
//   (6) --measure で各時刻の .demo-title__* の getBoundingClientRect と計算済みの font-size を JSON に出す
//
// 使い方:
//   node render-title.mjs <fragment.html> <outDir> --start 0.2333 --times 0.05,3.4,... \
//     [--mode preview|export] [--bgdir <dir>] [--fps 30] [--size 1280x720] [--prefix name] \
//     [--vars "--title-left:740px;..."] [--transparent] [--measure]
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
const times = arg("--times", "0").split(",").map(Number);
const mode = arg("--mode", "preview");
const bgdir = arg("--bgdir", null);
const fps = Number(arg("--fps", "30"));
const prefix = arg("--prefix", mode);
const vars = arg("--vars", "");
const transparent = process.argv.includes("--transparent");
const measure = process.argv.includes("--measure");
const [width, height] = arg("--size", "1280x720").split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const fragment = readFileSync(fragmentPath, "utf8");
const motionVocabCss = readFileSync(`${WT}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${transparent ? "transparent" : "#151515"}; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  #bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .akari-overlay-container { position: absolute; inset: 0; pointer-events: none;
    transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));
    transform-origin: center; ${vars} }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style><style>${motionVocabCss}</style></head><body>
  <div id="stage">${transparent ? "" : '<img id="bg" alt="">'}<div class="akari-overlay-container" data-start="${start}" style="--x:0px;--y:0px;--scale:1;--rotate:0deg"><div class="scene-content">${fragment}</div></div></div>
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
  await tab.setViewport({ width, height, deviceScaleFactor: 1 });
  const harnessPath = resolve(outDir, `.${prefix}.harness.html`);
  writeFileSync(harnessPath, page);
  await tab.goto(pathToFileURL(harnessPath).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
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
    return { animations: container.getAnimations({ subtree: true }).length,
      fonts: [...document.fonts].map((f) => `${f.family}:${f.weight}:${f.status}`) };
  }, mode);
  report.push({ setup });
  for (const local of times) {
    const composition = start + local;
    if (bgdir) {
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
      if (!measure) return { animations: animations.length };
      const boxes = {};
      for (const el of container.querySelectorAll("[class*='demo-title__']")) {
        const key = [...el.classList].find((c) => c.startsWith("demo-title__")) + (el.classList.length > 1 ? `.${el.classList[1]}` : "");
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        boxes[key] = { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), fontSize: cs.fontSize, opacity: cs.opacity };
      }
      // 文字のインク（描かれた字形）の箱: Range で文字ノードを囲む
      const ink = {};
      for (const sel of [".demo-title__lead", ".demo-title__main", ".demo-title__name"]) {
        const el = container.querySelector(sel);
        const range = document.createRange();
        range.selectNodeContents(el.firstChild);
        const r = range.getBoundingClientRect();
        ink[sel] = { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      }
      return { animations: animations.length, boxes, ink };
    }, mode, local, composition, measure);
    await new Promise((r) => setTimeout(r, 60));
    const name = `${prefix}-t${local.toFixed(3)}.png`;
    writeFileSync(resolve(outDir, name), await tab.screenshot({ omitBackground: transparent }));
    report.push({ local, composition: Number(composition.toFixed(4)), frame: Math.round(composition * fps), ...info, out: name });
  }
  try { unlinkSync(harnessPath); } catch {}
} finally {
  const proc = browser.process();
  if (proc) proc.kill("SIGKILL"); else await browser.close();
}
console.log(JSON.stringify(report, null, measure ? 1 : 0));
