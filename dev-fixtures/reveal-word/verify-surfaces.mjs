// ラッパー自身の検証スクリプト（受け入れ条件 6・8・9、および edit-store の挙動退行チェック）。
// 製品ソースではなく検証用フィクスチャ。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const baselineRoot = process.env.AKARI_BASELINE_ROOT;
const require = createRequire(join(repoRoot, "package.json"));
const report = {};

// ---- 受け入れ条件 6: シェルのパーサ ----
const { parsePreviewCaptions } = require(join(
  repoRoot, "apps/shell/extensions/akari-preview/lib/browser/akari-preview-captions.js",
));
const base = { id: "c-0001", start: 0, end: 2, text: "字幕", speaker: null, sourceRef: { segment: 0 }, edited: false };
const parsed = parsePreviewCaptions(JSON.stringify([
  { ...base, id: "c-0001", style: "reveal-word" },
  { ...base, id: "c-0002", start: 3, end: 5, style: "reveal" },
  { ...base, id: "c-0003", start: 6, end: 8, style: "karaoke" },
  { ...base, id: "c-0004", start: 9, end: 11, style: "pop" },
  { ...base, id: "c-0005", start: 12, end: 14, style: "typewriter" },
]));
report.shell_parser = Object.fromEntries(parsed.map(item => [item.id, item.style ?? null]));

// ---- 受け入れ条件 9: 契約 4 面 ----
const surfaces = {};

// schema（正本）
const schema = JSON.parse(await readFile(join(repoRoot, "packages/schemas/captions.schema.json"), "utf8"));
surfaces.schema_enum = schema.$defs.captionRecord.properties.style.enum;

// validator（CLI）
const validatorBin = join(repoRoot, "packages/schemas/bin/validate-captions.mjs");
const runValidator = style => {
  const payload = JSON.stringify({
    captions: [{ id: "c-0001", start: 0, end: 2, text: "字幕", speaker: null, sourceRef: { segment: 0 }, edited: false, style }],
  });
  const scratch = mkdtempSync(join(tmpdir(), "akari-validate-captions-"));
  const captionsPath = join(scratch, "captions.json");
  try {
    writeFileSync(captionsPath, payload, "utf8");
    const result = spawnSync(process.execPath, [validatorBin, captionsPath], { encoding: "utf8" });
    return { status: result.status, stderr: (result.stderr ?? "").trim().split("\n").slice(0, 2).join(" / ") };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
surfaces.validator = {
  "reveal-word": runValidator("reveal-word"),
  karaoke: runValidator("karaoke"),
  typewriter: runValidator("typewriter"),
};

// edit-store（display_policy との併用禁止判定）
const editStore = require(join(repoRoot, "packages/edit-store/lib/index.js"));
const policy = {
  mode: "single_line_sequential",
  algorithm: "a4-ja-two-fragment-v1",
  unit_metric: "ascii-half-other-one-v1",
  max_line_units: 6,
  minimum_fragment_duration_seconds: 0.72,
  locale: "ja",
};
const editForStore = {
  version: 0,
  source: { path: "source.mp4" },
  cuts: [{ in: 0, out: 2 }],
  output: { width: 1920, height: 1080, fps: 30 },
};
const runEditStore = (style, module = editStore) => {
  const captions = [{ ...base, ...(style === undefined ? {} : { style }) }];
  try {
    module.resolveCaptionDisplay({ display_policy: policy, captions }, editForStore);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? null, message: String(error.message ?? error) };
  }
};
surfaces.edit_store = {
  "reveal-word": runEditStore("reveal-word"),
  karaoke: runEditStore("karaoke"),
  typewriter: runEditStore("typewriter"),
  none: runEditStore(undefined),
};
if (baselineRoot) {
  const baselineStore = require(join(baselineRoot, "packages/edit-store/lib/index.js"));
  surfaces.edit_store_baseline = {
    "reveal-word": runEditStore("reveal-word", baselineStore),
    karaoke: runEditStore("karaoke", baselineStore),
    typewriter: runEditStore("typewriter", baselineStore),
    none: runEditStore(undefined, baselineStore),
  };
}

// edit-lint
const editLintSource = await readFile(join(repoRoot, "packages/edit-lint/src/edit-lint.mjs"), "utf8");
surfaces.edit_lint_message = /'style must be [^']*'/u.exec(editLintSource)?.[0] ?? null;
surfaces.edit_lint_accepts_reveal_word = /caption\.style !== "reveal-word"/u.test(editLintSource);
report.contract_surfaces = surfaces;

// ---- 受け入れ条件 8: 3 レンダラのクラス名 / custom property パリティ ----
const { renderStyledCaptionFragment } = await import(join(repoRoot, "packages/render-cut/src/captions.mjs"));
const words = [{ start: 1, end: 1.4, text: "読み" }, { start: 1.4, end: 2, text: "上げる" }];
const renderCutFragment = renderStyledCaptionFragment(words, "reveal-word", { rangeStart: 1, rangeEnd: 2 });

// preview-server: app.js から実ソースの関数本体を取り出してそのまま実行する
const appSource = await readFile(join(repoRoot, "packages/preview-server/public/app.js"), "utf8");
const extractFunction = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
};
// app.js の esc() は DOM 依存なので、テキストノード相当の最小 shim だけ与えて実ソースを動かす。
const previewFactory = new Function(`
  const document = { createElement: () => ({
    set textContent(value) { this._value = value; },
    get innerHTML() { return String(this._value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
  }) };
  ${extractFunction(appSource, "esc")}
  ${extractFunction(appSource, "renderStyledToken")}
  return { esc, renderStyledToken };
`);
const previewServerToken = previewFactory().renderStyledToken(words[1], 1, "reveal-word");

// shell: TS ソース内の webview スクリプト文字列から同じ関数を取り出して実行する
const shellSource = await readFile(join(
  repoRoot, "apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts",
), "utf8");
// `const <name> = ...;` を深さ 0 の `;` まで切り出す（文字列・正規表現リテラルを跨ぐため深さ追跡）。
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
      // 正規表現リテラル: 終端の / まで飛ばす
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
const shellFactory = new Function(`
  ${extractArrow(shellSource, "escapeCaptionHtml")}
  ${extractArrow(shellSource, "formatCaptionSeconds")}
  const findMatchingEmphasis = () => null;
  ${extractArrow(shellSource, "renderCaptionToken")}
  return renderCaptionToken;
`);
const shellToken = shellFactory()(words[1], 1, "reveal-word");

const tokenClass = "akari-caption__tok--reveal-word";
const delayVariable = "--akari-tok-delay";
const keyframeName = "akari-caption-reveal-word";
report.parity = {
  render_cut_token: /<span class="akari-caption__tok akari-caption__tok--reveal-word"[^>]*>上げる<\/span>/u
    .exec(renderCutFragment)?.[0] ?? null,
  preview_server_token: previewServerToken,
  shell_token: shellToken,
  all_use_token_class: [renderCutFragment, previewServerToken, shellToken].every(value => value.includes(tokenClass)),
  all_use_delay_variable: [renderCutFragment, previewServerToken, shellToken].every(value => value.includes(delayVariable)),
  keyframe_name_in_all: [
    renderCutFragment,
    appSource,
    shellSource,
  ].every(value => value.includes(keyframeName)),
  animation_declaration: {
    render_cut: /animation: akari-caption-reveal-word [^;]+;/u.exec(renderCutFragment)?.[0] ?? null,
    preview_server: /animation:akari-caption-reveal-word [^;]+;/u.exec(appSource)?.[0] ?? null,
    shell: /animation:akari-caption-reveal-word [^;]+;/u.exec(shellSource)?.[0] ?? null,
  },
};

console.log(JSON.stringify(report, null, 2));
