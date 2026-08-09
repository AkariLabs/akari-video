// ラッパー自身の検証スクリプト（受け入れ条件 1・2・4・5）。製品ソースではなく検証用フィクスチャ。
// - 受け入れ条件 1: パーサが "reveal" を受理する（main は undefined に落とすことも同時に実測）
// - 受け入れ条件 2: シェルの生成 HTML が akari-caption--reveal / akari-caption__reveal-group を含む
// - 受け入れ条件 4: 縦長 + 無指定 + 複数行 の自動昇格マークアップが main とバイト同一
// - 受け入れ条件 5: karaoke / pop / reveal-word の出力（パーサ出力 + 生成 HTML）が main とバイト同一
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const require = createRequire(join(repoRoot, "package.json"));
const report = {};

const PARSER_PATH = "apps/shell/extensions/akari-preview/src/browser/akari-preview-captions.ts";
const HANDLER_PATH = "apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts";

const gitShow = path => {
  const result = spawnSync("git", ["show", `main:${path}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git show main:${path} failed: ${result.stderr}`);
  return result.stdout;
};

// ---- パーサ 2 系統: main は同一 TypeScript コンパイラで transpile、worktree はビルド済み lib（実配布物）----
const ts = require(join(repoRoot, "apps/shell/node_modules/typescript/lib/typescript.js"));
const scratch = mkdtempSync(join(tmpdir(), "akari-reveal-drop-"));
const transpileToModule = (source, name) => {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const path = join(scratch, `${name}.cjs`);
  writeFileSync(path, output, "utf8");
  return require(path);
};
const mainParser = transpileToModule(gitShow(PARSER_PATH), "captions-main").parsePreviewCaptions;
const newParser = require(join(
  repoRoot, "apps/shell/extensions/akari-preview/lib/browser/akari-preview-captions.js",
)).parsePreviewCaptions;

const base = { id: "c-0001", start: 0, end: 2, text: "字幕", speaker: null, sourceRef: { segment: 0 }, edited: false };
const styleFixture = JSON.stringify([
  { ...base, id: "c-reveal", style: "reveal" },
  { ...base, id: "c-karaoke", start: 3, end: 5, style: "karaoke" },
  { ...base, id: "c-pop", start: 6, end: 8, style: "pop" },
  { ...base, id: "c-reveal-word", start: 9, end: 11, style: "reveal-word" },
  { ...base, id: "c-typewriter", start: 12, end: 14, style: "typewriter" },
  { ...base, id: "c-none", start: 15, end: 17 },
]);
const styleMap = parsed => Object.fromEntries(parsed.map(item => [item.id, item.style ?? null]));
report.acceptance_1_parser = {
  main: styleMap(mainParser(styleFixture)),
  worktree: styleMap(newParser(styleFixture)),
};

// ---- レンダラ: open-handler.ts（webview スクリプト文字列）から実ソースの関数群を取り出して実行 ----
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
// webview スクリプトはテンプレートリテラル内にあるため、抽出片のエスケープを戻す
// （\\ → \、\` → `、\$ → $。対象関数群は ${} 補間を含まないことを前提に、含んだら fail させる）
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
const buildRenderer = (source, portrait) => new Function(`
  const captionPortrait = ${JSON.stringify(portrait)};
  const captionLineBudget = captionPortrait ? 10 : 20;
  const findMatchingEmphasis = () => null;
  const renderEmphasisCaptionToken = () => { throw new Error("emphasis path must not run"); };
  ${RENDERER_PARTS.map(name => unescapeTemplate(extractArrow(source, name))).join("\n")}
  return renderStyledCaptionFragment;
`)();

const handlerSource = await readFile(join(repoRoot, HANDLER_PATH), "utf8");
const handlerMainSource = gitShow(HANDLER_PATH);
report.open_handler_identical_to_main = handlerSource === handlerMainSource;

// ---- 受け入れ条件 2: 明示 reveal（横長 1920x1080 相当 = 自動昇格に頼らない経路）----
// 行 1 = 4 字（幅狭）/ 行 2 = 20 字（幅広）。カタカナは CAPTION_BOUNDARIES に掛からず 20 字上限で折れる。
const revealWords = [
  { start: 0, end: 1, text: "アイウエ" },
  { start: 1, end: 2, text: "サシスセソタチツナミサシスセソタチツナミ" },
];
const revealCaptionJson = JSON.stringify([{
  ...base, id: "c-reveal", start: 0, end: 2,
  text: revealWords.map(word => word.text).join(""), style: "reveal", words: revealWords,
}]);
const newRenderer = buildRenderer(handlerSource, false);
const mainRenderer = buildRenderer(handlerMainSource, false);
const newRevealCaption = newParser(revealCaptionJson)[0];
const explicitRevealMarkup = newRenderer(newRevealCaption);
report.acceptance_2_markup = {
  parsed_style: newRevealCaption.style ?? null,
  has_root_class: explicitRevealMarkup.includes("akari-caption--reveal"),
  reveal_group_count: (explicitRevealMarkup.match(/akari-caption__reveal-group/gu) ?? []).length,
  markup_head: explicitRevealMarkup.slice(0, 120),
};
// main のパーサは reveal を落とすため、同じ入力では明示 reveal が karaoke 扱いになる（=バグの実測）
const mainRevealCaption = mainParser(revealCaptionJson)[0];
report.acceptance_2_main_baseline = {
  parsed_style: mainRevealCaption.style ?? null,
  main_markup_has_reveal_root: mainRenderer(mainRevealCaption).includes("akari-caption--reveal"),
};

// ---- 受け入れ条件 4: 縦長 + 無指定 + 複数行 の自動昇格が main とバイト同一 ----
const promotedWords = [
  { start: 0, end: 1, text: "アイウエオカキクケコ" },
  { start: 1, end: 2, text: "サシスセソタチツナミ" },
];
const promotedJson = JSON.stringify([{
  ...base, id: "c-promoted", start: 0, end: 2,
  text: promotedWords.map(word => word.text).join(""), words: promotedWords,
}]);
const newPortraitRenderer = buildRenderer(handlerSource, true);
const mainPortraitRenderer = buildRenderer(handlerMainSource, true);
const promotedNew = newPortraitRenderer(newParser(promotedJson)[0]);
const promotedMain = mainPortraitRenderer(mainParser(promotedJson)[0]);
report.acceptance_4_auto_promotion = {
  byte_identical_to_main: promotedNew === promotedMain,
  has_root_class: promotedNew.includes("akari-caption--reveal"),
  reveal_group_count: (promotedNew.match(/akari-caption__reveal-group/gu) ?? []).length,
};

// ---- 受け入れ条件 5: karaoke / pop / reveal-word のパーサ出力 + 生成 HTML が main とバイト同一 ----
const words = [{ start: 0, end: 1, text: "読み" }, { start: 1, end: 2, text: "上げる" }];
const byteCases = {};
for (const style of ["karaoke", "pop", "reveal-word"]) {
  const json = JSON.stringify([{ ...base, id: `c-${style}`, start: 0, end: 2, text: "読み上げる", style, words }]);
  const parsedMain = mainParser(json);
  const parsedNew = newParser(json);
  const markupMain = mainRenderer(parsedMain[0]);
  const markupNew = newRenderer(parsedNew[0]);
  byteCases[style] = {
    parser_output_byte_identical: JSON.stringify(parsedMain) === JSON.stringify(parsedNew),
    markup_byte_identical: markupMain === markupNew,
    markup_length: markupNew.length,
  };
}
{
  // 未知値・無指定もパーサ出力の同一性を確認（退行なしの傍証）
  const json = JSON.stringify([
    { ...base, id: "c-typewriter", style: "typewriter" },
    { ...base, id: "c-none", start: 3, end: 5 },
  ]);
  byteCases.unknown_and_none = {
    parser_output_byte_identical: JSON.stringify(mainParser(json)) === JSON.stringify(newParser(json)),
  };
}
report.acceptance_5_byte_identity = byteCases;

rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
