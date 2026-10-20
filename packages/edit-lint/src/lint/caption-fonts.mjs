import { join } from "node:path";

import { readLocalLibraryItem, scanLocalLibrary } from "../../../asset-resolver/src/library.mjs";
import { fontCatalog, fontTitle, matchFontCatalog, readFontNames } from "../../../asset-resolver/src/font-names.mjs";
import { addFinding, isRecord } from "./shared.mjs";

// render-cut の書き出し（GPU / OSR）が埋め込める書体は、同梱フォントと素材
// ライブラリの font 素材だけ。プレビューはブラウザが OS のフォントへ fall back
// するため、同じ font_family でも書き出しだけが失敗する（2026-10-20 報告 §7）。
//
// この一覧は packages/render-cut/src/caption-font-faces.json の写し。実行時に
// render-cut を import すると npm 配布の CLI（edit-lint 単体）で閉包が欠けるため、
// 依存を持たずに静的に照合する。写しであることは test/caption-font-availability.test.mjs
// が本家 JSON と突き合わせて守る。
export const BUNDLED_CAPTION_FONT_FAMILIES = Object.freeze([
  "Noto Sans",
  "Noto Sans JP",
  "Noto Serif JP",
  "M PLUS Rounded 1c",
  "BIZ UDGothic",
  "Dela Gothic One",
  "Zen Maru Gothic",
  "Shippori Mincho",
  "DotGothic16",
  "Klee One",
]);

// 字幕パネルが保存する product alias（render-cut の captionFontFaces と同じ扱い）。
const CAPTION_FONT_ALIASES = Object.freeze(["AKARI Noto Sans", "AKARI Noto Sans JP"]);

const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

// render-cut/src/caption-font-faces.mjs の captionFontFamilies と同じ分解。
// 書き出し側が「書体名の並び」として解釈する単位に揃える。
export function captionFontFamilies(value) {
  if (typeof value !== "string") return [];
  const parts = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) { token += value[++index]; continue; }
    if (quote) { if (character === quote) quote = null; else token += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === ",") { parts.push(token.trim()); token = ""; continue; }
    token += character;
  }
  parts.push(token.trim());
  return parts.filter((name) => name && !GENERIC_FONT_FAMILIES.has(name.toLowerCase()));
}

// 素材ライブラリの font 素材。render-cut の libraryCaptionFontFaces と同じ名前集合
// （title / aliases / フォント内部名 / カタログ照合）を静的に集める。
function libraryCaptionFontFamilies(env) {
  const families = new Set();
  const catalog = fontCatalog();
  for (const key of scanLocalLibrary(env)) {
    if (!key.startsWith("font/")) continue;
    const item = readLocalLibraryItem(env, "font", key.slice(5));
    if (!item?.mediaFile || !item.libraryDir) continue;
    const names = [fontTitle(item.title), ...(Array.isArray(item.aliases) ? item.aliases : [])];
    if (!Array.isArray(item.aliases)) {
      names.push(...(readFontNames(join(item.libraryDir, item.mediaFile))?.all ?? []));
    }
    const matched = matchFontCatalog(names, catalog);
    if (matched) names.push(matched.title);
    for (const name of names) if (typeof name === "string" && name.trim()) families.add(name);
  }
  return families;
}

export function availableCaptionFontFamilies(env = process.env) {
  return new Set([
    ...BUNDLED_CAPTION_FONT_FAMILIES,
    ...CAPTION_FONT_ALIASES,
    ...libraryCaptionFontFamilies(env),
  ]);
}

const PREFERRED_ALTERNATIVES = Object.freeze(["Noto Sans JP", "Noto Sans", "M PLUS Rounded 1c"]);

/** 代替候補を最大 3 個。同梱の既定書体を優先し、足りなければ利用可能な書体から足す。 */
export function captionFontAlternatives(available, requested = new Set(), limit = 3) {
  const alternatives = [];
  const push = (name) => {
    if (alternatives.length >= limit || !available.has(name) || requested.has(name)
      || alternatives.includes(name)) return;
    alternatives.push(name);
  };
  for (const name of PREFERRED_ALTERNATIVES) push(name);
  if (alternatives.length < limit) {
    for (const name of [...available].sort((left, right) => left.localeCompare(right, "en"))) push(name);
  }
  return alternatives;
}

function quoteList(names) {
  return names.map((name) => JSON.stringify(name)).join(", ");
}

/**
 * captions.json の font_family（default_text_style と各 caption の text_style）を、
 * 書き出しで使える書体の一覧と静的に照合する。重い解決処理は呼ばない。
 */
export function validateCaptionFontAvailability(captionsRoot, captions, findings, captionPath, { env = process.env } = {}) {
  let available;
  const getAvailable = () => (available ??= availableCaptionFontFamilies(env));
  if (!Array.isArray(captionsRoot) && isRecord(captionsRoot?.default_text_style)) {
    checkStyle(captionsRoot.default_text_style, `${captionPath}#default_text_style`);
  }
  for (const [index, caption] of (Array.isArray(captions) ? captions : []).entries()) {
    if (isRecord(caption) && isRecord(caption.text_style)) {
      checkStyle(caption.text_style, `${captionPath}#[${index}].text_style`);
    }
  }

  function checkStyle(style, path) {
    const families = captionFontFamilies(style.font_family);
    if (families.length === 0) return;
    const fonts = getAvailable();
    const missing = families.filter((name) => !fonts.has(name));
    if (missing.length === 0) return;
    const alternatives = captionFontAlternatives(fonts, new Set(families));
    const hint = alternatives.length
      ? `use one of ${quoteList(alternatives)}`
      : "use a bundled caption font";
    for (const name of missing) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.font-unavailable",
        message: `font_family ${JSON.stringify(name)} is not available to the export renderer (GPU/OSR only embed bundled fonts and installed font library assets); ${hint}`,
        path,
      });
    }
  }
}
