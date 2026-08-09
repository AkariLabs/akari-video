// ラッパー自身の検証スクリプト（受け入れ条件 7）。
// preview-server の実ソース（public/app.js）から CSS 注入・トークン生成・アニメーション同期の
// 3 つを取り出し、preview と同じ経路で seek した実ブラウザ画素を測る。
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const { findChromePath } = await import(join(repoRoot, "packages/render-cut/src/render-cut.mjs"));
const puppeteer = (await import("puppeteer-core")).default;

const chromePath = await findChromePath();
if (!chromePath) throw new Error("headless Chrome not found");

const appSource = await readFile(join(repoRoot, "packages/preview-server/public/app.js"), "utf8");

// injectCaptionStyles() が実際に流し込む CSS 文字列をソースからそのまま取り出す。
const cssStart = appSource.indexOf("function injectCaptionStyles()");
const cssOpen = appSource.indexOf("style.textContent = `", cssStart) + "style.textContent = `".length;
const cssClose = appSource.indexOf("`;", cssOpen);
const captionCss = appSource.slice(cssOpen, cssClose);
if (!captionCss.includes("akari-caption__tok--reveal-word")) {
  throw new Error("preview-server CSS does not declare the reveal-word token");
}

// renderStyledToken() も実ソースから取り出して、preview と同じマークアップを組む。
const tokenStart = appSource.indexOf("function renderStyledToken(");
const tokenEnd = appSource.indexOf("\n}\n", tokenStart) + 3;
const tokenSource = appSource.slice(tokenStart, tokenEnd);

const WIDTH = 480;
const HEIGHT = 240;
const BACKGROUND_RGB = [0x00, 0x00, 0x00];
const words = [{ start: 0, end: 0.5, text: "前" }, { start: 0.5, end: 1, text: "後" }];

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
});
const scratch = await mkdtemp(join(tmpdir(), "akari-preview-reveal-word-"));
const report = { chromePath, width: WIDTH, height: HEIGHT };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    html,body { margin:0; width:100%; height:100%; background:#000; overflow:hidden; }
    #plate { position:absolute; inset:0; }
  </style></head><body><div id="plate"></div></body></html>`);

  const markup = await page.evaluate(({ tokenSource, captionCss, words }) => {
    const esc = value => { const node = document.createElement("div"); node.textContent = value; return node.innerHTML; };
    // eslint-disable-next-line no-new-func
    const renderStyledToken = new Function("esc", `${tokenSource}; return renderStyledToken;`)(esc);
    const style = document.createElement("style");
    style.textContent = captionCss;
    document.head.appendChild(style);
    const html = `<div class="akari-caption"><div class="akari-caption__plate"><p class="akari-caption__line">${
      words.map(word => renderStyledToken(word, 0, "reveal-word")).join("")
    }</p></div></div>`;
    document.getElementById("plate").innerHTML = html;
    return html;
  }, { tokenSource, captionCss, words });
  report.markup = markup;

  // preview-server の syncCaptionAnimations() と同じ seek（pause + currentTime）を使う。
  const sampleAt = async (seconds, name) => {
    await page.evaluate(milliseconds => {
      const plate = document.getElementById("plate");
      for (const animation of plate.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = milliseconds;
      }
    }, seconds * 1000);
    const path = join(scratch, `${name}.png`);
    await page.screenshot({ path });
    const decoded = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", path,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ], { encoding: "buffer", maxBuffer: 1 << 28 });
    if (decoded.status !== 0) throw new Error(decoded.stderr.toString("utf8"));
    return decoded.stdout;
  };

  const box = await page.evaluate(() => {
    const token = document.querySelectorAll(".akari-caption__tok--reveal-word")[1];
    const rect = token.getBoundingClientRect();
    return { left: Math.floor(rect.left), top: Math.floor(rect.top), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  });
  report.second_token_box = box;

  const countNonBackground = (buffer, region) => {
    let count = 0;
    let brightest = [0, 0, 0];
    let brightestAt = null;
    for (let y = region.top; y < region.top + region.height; y += 1) {
      for (let x = region.left; x < region.left + region.width; x += 1) {
        const offset = (y * WIDTH + x) * 3;
        const pixel = [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
        if (pixel[0] !== BACKGROUND_RGB[0] || pixel[1] !== BACKGROUND_RGB[1] || pixel[2] !== BACKGROUND_RGB[2]) count += 1;
        if (Math.min(...pixel) > Math.min(...brightest)) { brightest = pixel; brightestAt = { x, y }; }
      }
    }
    return { non_background_pixels: count, brightest, brightest_at: brightestAt };
  };

  const before = await sampleAt(0.5 - 2 / 30, "before");
  const after = await sampleAt(0.5 + 2 / 30, "after");
  const ending = await sampleAt(1 - 1 / 30, "ending");

  report.second_word = {
    word: "後",
    word_start_seconds: 0.5,
    before_seconds: Number((0.5 - 2 / 30).toFixed(4)),
    after_seconds: Number((0.5 + 2 / 30).toFixed(4)),
    ending_seconds: Number((1 - 1 / 30).toFixed(4)),
    before: countNonBackground(before, box),
    after: countNonBackground(after, box),
    ending: countNonBackground(ending, box),
  };
  report.hidden_before_spoken = report.second_word.before.non_background_pixels === 0;
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
