// ラッパー自身の検証スクリプト（受け入れ条件 3、および 4 の順送り直接観測）。
// 製品ソースではなく検証用フィクスチャ。
// シェルの実ソース（ビルド済みパーサ lib + open-handler.ts の webview 関数群）で生成した
// フラグメントを headless Chrome に流し、renderCaption() と同じ seek（pause + currentTime）で
// 「1 行目の出現直後に 2 行目の領域が背景色」「2 行目開始後に 2 行目が現れる」を画素で測る。
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const require = createRequire(join(repoRoot, "package.json"));
const { findChromePath } = await import(join(repoRoot, "packages/render-cut/src/render-cut.mjs"));
const puppeteer = (await import("puppeteer-core")).default;

const { parsePreviewCaptions } = require(join(
  repoRoot, "apps/shell/extensions/akari-preview/lib/browser/akari-preview-captions.js",
));

// ---- open-handler.ts から webview レンダラ関数群を取り出す（verify-parser-and-markup.mjs と同じ方式）----
const extractArrow = (source, name) => {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`arrow ${name} not found`);
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") { quote = character; continue; }
    if (character === "/" && "([{,=:".includes((source.slice(0, index).trimEnd().slice(-1) || ""))) {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== "/") {
        if (source[cursor] === "\\") cursor += 1;
        cursor += 1;
      }
      index = cursor;
      continue;
    }
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
    else if (character === ";" && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`arrow ${name} has no terminator`);
};
const unescapeTemplate = snippet => {
  if (/(?<!\\)\$\{/u.test(snippet)) throw new Error("snippet contains template interpolation");
  return snippet.replace(/\\([\\`$])/gu, "$1");
};
const RENDERER_PARTS = [
  "CAPTION_BOUNDARIES", "findLastSpaceBoundary", "findLastPhraseBoundary",
  "splitAtNaturalBoundaries", "splitAfterPunctuation", "splitCaptionLines",
  "escapeCaptionHtml", "formatCaptionSeconds", "groupWordsIntoLines",
  "groupWordsIntoDisplayLines", "renderRevealGroupsMarkup", "renderCaptionToken",
  "renderStyledCaptionFragment",
];
const handlerSource = await readFile(join(
  repoRoot, "apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts",
), "utf8");
const buildRenderer = portrait => new Function(`
  const captionPortrait = ${JSON.stringify(portrait)};
  const captionLineBudget = captionPortrait ? 10 : 20;
  const findMatchingEmphasis = () => null;
  const renderEmphasisCaptionToken = () => { throw new Error("emphasis path must not run"); };
  ${RENDERER_PARTS.map(name => unescapeTemplate(extractArrow(handlerSource, name))).join("\n")}
  return renderStyledCaptionFragment;
`)();

const base = { id: "c-0001", speaker: null, sourceRef: { segment: 0 }, edited: false };
// 行 1 = 幅狭 / 行 2 = 幅広。行 2 の左端 1/4 は行 1（中央寄せ）と重ならないため、
// 「行 2 の領域が背景色か」をそこで判定できる。カタカナは文節境界に掛からない。
const cases = {
  explicit_reveal: {
    portrait: false,
    caption: {
      ...base, start: 0, end: 2, style: "reveal",
      text: "アイウエ" + "サシスセソタチツナミサシスセソタチツナミ",
      words: [
        { start: 0, end: 1, text: "アイウエ" },
        { start: 1, end: 2, text: "サシスセソタチツナミサシスセソタチツナミ" },
      ],
    },
  },
  auto_promoted: {
    portrait: true,
    caption: {
      ...base, start: 0, end: 2,
      text: "アイウ" + "サシスセソタチツナミ",
      words: [
        { start: 0, end: 1, text: "アイウ" },
        { start: 1, end: 2, text: "サシスセソタチツナミ" },
      ],
    },
  },
};

const WIDTH = 960;
const HEIGHT = 360;
const BACKGROUND_RGB = [0, 0, 0];

const chromePath = await findChromePath();
if (!chromePath) throw new Error("headless Chrome not found");
const ffprobe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffprobe.status !== 0) throw new Error("ffmpeg not found");

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
});
const scratch = await mkdtemp(join(tmpdir(), "akari-reveal-drop-pixels-"));
const report = { chrome: chromePath, width: WIDTH, height: HEIGHT };
try {
  for (const [name, spec] of Object.entries(cases)) {
    const parsed = parsePreviewCaptions(JSON.stringify([spec.caption]))[0];
    const fragment = buildRenderer(spec.portrait)(parsed);
    const entry = {
      parsed_style: parsed.style ?? null,
      fragment_has_reveal_root: fragment.includes("akari-caption--reveal"),
    };

    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>
      html,body { margin:0; width:100%; height:100%; background:#000; overflow:hidden; }
      #host { position:absolute; inset:0; }
    </style></head><body><div id="host"></div></body></html>`);
    await page.evaluate(html => { document.getElementById("host").innerHTML = html; }, fragment);

    // renderCaption() と同じ seek: 全アニメーションを pause して currentTime を字幕ローカル時刻へ
    const seek = async seconds => {
      await page.evaluate(milliseconds => {
        for (const animation of document.getElementById("host").getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = milliseconds;
        }
      }, seconds * 1000);
    };
    const shot = async (seconds, label) => {
      await seek(seconds);
      const path = join(scratch, `${name}-${label}.png`);
      await page.screenshot({ path });
      const decoded = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-i", path,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
      ], { encoding: "buffer", maxBuffer: 1 << 28 });
      if (decoded.status !== 0) throw new Error(decoded.stderr.toString("utf8"));
      return decoded.stdout;
    };
    const countNonBackground = (buffer, region) => {
      let count = 0;
      for (let y = region.top; y < region.top + region.height; y += 1) {
        for (let x = region.left; x < region.left + region.width; x += 1) {
          const offset = (y * WIDTH + x) * 3;
          if (buffer[offset] !== BACKGROUND_RGB[0]
            || buffer[offset + 1] !== BACKGROUND_RGB[1]
            || buffer[offset + 2] !== BACKGROUND_RGB[2]) count += 1;
        }
      }
      return count;
    };

    const boxes = await page.evaluate(() => {
      const groups = document.querySelectorAll(".akari-caption__reveal-group");
      const rect = element => {
        const value = element.getBoundingClientRect();
        return {
          left: Math.floor(value.left), top: Math.floor(value.top),
          width: Math.ceil(value.width), height: Math.ceil(value.height),
        };
      };
      return {
        group_count: groups.length,
        line1: rect(groups[0].querySelector(".akari-caption__line")),
        line2: rect(groups[1].querySelector(".akari-caption__line")),
      };
    });
    entry.boxes = boxes;
    // 行 2 の左端 1/4（中央寄せの行 1 と重ならない領域）
    const line2Left = {
      left: boxes.line2.left,
      top: boxes.line2.top,
      width: Math.max(1, Math.floor(boxes.line2.width / 4)),
      height: boxes.line2.height,
    };
    const line1Box = boxes.line1;
    if (line2Left.left + line2Left.width >= line1Box.left) {
      throw new Error("regions overlap; fixture assumption broken");
    }

    // 行 1 出現直後（t=0.3s: 行 1 のアニメは 12% を超えて可視 / 行 2 は delay 前 = 0% opacity:0）
    const atLine1 = await shot(0.3, "line1-shown");
    // 行 2 開始後（t=1.3s: 行 2 可視 / 行 1 は duration 終端超え = 100% opacity:0）
    const atLine2 = await shot(1.3, "line2-shown");
    entry.samples = {
      line1_shown_at: 0.3,
      line2_shown_at: 1.3,
      line1_pixels_when_line1_shown: countNonBackground(atLine1, line1Box),
      line2_region_pixels_when_line1_shown: countNonBackground(atLine1, line2Left),
      line2_region_pixels_when_line2_shown: countNonBackground(atLine2, line2Left),
    };
    entry.line2_hidden_while_line1_shown = entry.samples.line2_region_pixels_when_line1_shown === 0;
    entry.line2_appears_after_line1 = entry.line2_hidden_while_line1_shown
      && entry.samples.line2_region_pixels_when_line2_shown > 0
      && entry.samples.line1_pixels_when_line1_shown > 0;
    report[name] = entry;
    await page.close();
  }
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
