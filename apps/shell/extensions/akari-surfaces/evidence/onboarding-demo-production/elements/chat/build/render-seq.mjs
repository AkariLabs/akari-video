// demo-chat 断片の確認用レンダラ（Windows 版・スクラッチ）。
// 内部リポ harness/render-fragment.mjs と同じ入れ子
// （.akari-overlay-container[inset:0] > .scene-content[inset:0] > 断片）とモーション語彙を敷き、
// 加えて (1) 活性ゲート data-akari-active を容器へ付ける（プレビュー・書き出しと同じ）、
// (2) --mode export では render-cut/src/rasterize.mjs と同じ「CSS animation → paused WAAPI クローン
// （delay に start を足す）」変換をしてから合成時刻で seek する、(3) 背景に本編の該当フレームを敷く。
//
// 使い方:
//   node render-seq.mjs <fragment.html> <outDir> --start 8.5333 --times 0.05,0.4,... \
//     [--mode preview|export] [--bgdir <dir of f<frame>.png>] [--fps 30] [--size 1280x720] [--prefix name]
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WT = "<WORKTREE>";
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
      // rasterize.mjs の変換をそのまま写す（ゲートを一時的に立てて CSS animation を集め、
      // start を delay に足した paused WAAPI クローンへ置き換える）
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
    const count = await tab.evaluate((mode, local, composition) => {
      const container = document.querySelector(".akari-overlay-container");
      const ms = (mode === "export" ? composition : local) * 1000;
      const animations = container.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = ms;
      }
      return animations.length;
    }, mode, local, composition);
    await new Promise((r) => setTimeout(r, 60));
    const name = `${prefix}-t${local.toFixed(3)}.png`;
    writeFileSync(resolve(outDir, name), await tab.screenshot({ omitBackground: transparent }));
    report.push({ local, composition: Number(composition.toFixed(4)), animations: count, out: name });
  }
  try { unlinkSync(harnessPath); } catch {}
} finally {
  const proc = browser.process();
  if (proc) proc.kill("SIGKILL"); else await browser.close();
}
console.log(JSON.stringify(report));
