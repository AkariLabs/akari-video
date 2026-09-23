import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { RenderInputError, resolveDeclaredProjectInput } from "./render-inputs.mjs";

const TYPES = new Map([
  ...Object.entries({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" }).map(([ext, mime]) => [ext, ["still-image", mime]]),
  ...["ttf", "otf", "woff", "woff2"].map(ext => [ext, ["font", `font/${ext}`]]),
  ...["mp4", "mov", "webm", "mkv", "m4v"].map(ext => [ext, ["video", null]]),
  ...["wav", "mp3", "m4a", "aac", "ogg", "flac"].map(ext => [ext, ["audio", null]]),
]);
const MAX_EMBED_BYTES = 16 * 1024 * 1024;

export function extractFragmentAssetReferences(html, htmlPath, overlayLabel = "overlay") {
  return scanReferences(html, htmlPath).map(({ start, end, ...reference }) => reference);
}

export function extractAbsoluteFragmentAssetReferences(html, htmlPath) {
  return scanReferences(html, htmlPath, true).map(({ start, end, ...reference }) => reference);
}

/** CSS url() values and source ranges for the undeclared-asset guard. */
export function scanFragmentCssUrls(html) {
  const values = [];
  const unfinished = [];
  const ranges = [];
  scanReferences(html, "", false, {
    onCssUrl: value => values.push(value),
    onUnfinishedCssUrl: value => unfinished.push(value),
    onCssRange: (start, end) => ranges.push({ start, end }),
  });
  return { values, unfinished, ranges };
}

/** Rewrite only asset URL tokens; raw text, comments, and surrounding syntax stay intact. */
export function rewriteFragmentAssetUrls(html, { htmlPath, urlPrefix = "/", resolveUrl }) {
  let result = html;
  for (const reference of scanReferences(html, htmlPath).reverse()) {
    const replacement = resolveUrl?.(reference)
      ?? urlPrefix + reference.path.split("/").map(encodeURIComponent).join("/");
    result = result.slice(0, reference.start) + replacement + result.slice(reference.end);
  }
  return result;
}

export function describeFragmentAssetHint({ projectRoot, htmlPath, raw, path }) {
  const root = realpathSync(resolve(projectRoot));
  const within = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local !== ".." && !local.startsWith("../") && !isAbsolute(local);
  };
  const isFile = target => {
    try { return within(realpathSync(target)) && statSync(target).isFile(); } catch { return false; }
  };
  if (!within(resolve(root, path)) || isFile(resolve(root, path))) return "";
  // Also recognize the common ../assets spelling intended to reach project assets.
  const candidates = [raw, raw.replace(/^(?:\.\.?\/)+/u, "")];
  for (const candidate of candidates) {
    const target = resolve(root, candidate);
    if (!within(target) || !isFile(target)) continue;
    const local = relative(root, target).replaceAll("\\", "/");
    const correction = relative(resolve(root, dirname(htmlPath)), target).replaceAll("\\", "/");
    return `断片ファイル基準では \`${path}\` を指しています。project の \`${local}\` を指すなら \`${correction}\` に直してください`;
  }
  return "";
}

export function embedFragmentAssets(html, { projectRoot, htmlPath, overlayId }) {
  const references = scanReferences(html, htmlPath);
  const replacements = new Map();
  let result = html;
  // Apply edits from the end so every offset still refers to the original HTML.
  for (const reference of references.reverse()) {
    const { raw, path, role, start, end } = reference;
    const context = `overlay:${overlayId} fragment ${htmlPath} の参照 "${raw}"`;
    let replacement = replacements.get(path);
    if (replacement === undefined) {
      let absolute;
      try {
        absolute = resolveDeclaredProjectInput(projectRoot, path, `overlay:${overlayId}:fragment-asset`);
      } catch (error) {
        if (error instanceof RenderInputError) {
          const hint = describeFragmentAssetHint({ projectRoot, htmlPath, raw, path });
          error.message = `${context}: ${error.message}${hint ? ` ${hint}` : ""}`;
        }
        throw error;
      }
      if (role === "video" || role === "audio") {
        const local = relative(realpathSync(resolve(projectRoot)), absolute).replaceAll("\\", "/");
        if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
          throw new RenderInputError(`${context}: 動画・音声はプロジェクト内に置く`);
        }
        replacement = `/media/${local.split("/").map(encodeURIComponent).join("/")}`;
      } else {
        const size = statSync(absolute).size;
        if (size > MAX_EMBED_BYTES) {
          throw new RenderInputError(`${context}: ${(size / 1024 / 1024).toFixed(6)} MiB exceeds 16 MiB. 縮小するか video として扱う`);
        }
        replacement = `data:${assetType(path)[1]};base64,${readFileSync(absolute).toString("base64")}`;
      }
      replacements.set(path, replacement);
    }
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

function assetType(path) {
  return TYPES.get(extname(path).slice(1).toLowerCase()) ?? ["file", "application/octet-stream"];
}

function scanReferences(html, htmlPath, absoluteOnly = false, { onCssUrl, onUnfinishedCssUrl, onCssRange } = {}) {
  const references = [];
  const add = (value, offset, attribute) => {
    const raw = value.trim();
    if (absoluteOnly) {
      if (!/^(?:[a-z]:[\\/]|file:|\\\\|\/(?!\/|media\/))/iu.test(raw)) return;
    } else if (!raw || /^(?:[a-z][a-z\d+.-]*:|#|\/)/iu.test(raw) || raw.includes("\\")) return;
    const start = offset + value.indexOf(raw);
    const path = join(dirname(htmlPath), raw).replaceAll("\\", "/");
    references.push({ role: assetType(path)[0], attribute, raw, path, start, end: start + raw.length });
  };
  const css = (text, offset, attribute) => {
    onCssRange?.(offset, offset + text.length);
    // Consume comments and other strings whole: their url(...) text is not a CSS URL.
    const tokens = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\burl\(/giu;
    let token;
    while ((token = tokens.exec(text)) !== null) {
      if (!/url\($/iu.test(token[0])) continue;
      let cursor = tokens.lastIndex;
      while (/\s/u.test(text[cursor] ?? "") && cursor < text.length) cursor++;
      const quote = text[cursor] === '"' || text[cursor] === "'" ? text[cursor++] : null;
      const start = cursor;
      let depth = 0;
      while (cursor < text.length) {
        const char = text[cursor];
        if (char === "\\") { cursor += 2; continue; }
        if (quote && char === quote) break;
        if (!quote && (char === '"' || char === "'")) {
          const innerQuote = char;
          cursor++;
          while (cursor < text.length && text[cursor] !== innerQuote) {
            cursor += text[cursor] === "\\" ? 2 : 1;
          }
          if (cursor < text.length) cursor++;
          continue;
        }
        if (!quote && char === "(") depth++;
        if (!quote && char === ")") {
          if (depth === 0) break;
          depth--;
        }
        cursor++;
      }
      const end = cursor;
      if (quote && text[cursor] === quote) cursor++;
      while (/\s/u.test(text[cursor] ?? "") && cursor < text.length) cursor++;
      if (text[cursor] !== ")" || depth !== 0) {
        // Keep reference extraction unchanged; the guard separately preserves its old
        // rejection of unfinished url( using the former regex's value boundary.
        const unfinished = /^url\(\s*["']?([^"')]+)/iu.exec(html.slice(offset + token.index));
        if (unfinished) onUnfinishedCssUrl?.(unfinished[1]);
        tokens.lastIndex = text.length;
        continue;
      }
      const value = text.slice(start, end);
      onCssUrl?.(value);
      add(value, offset + start, attribute);
      tokens.lastIndex = cursor + 1;
    }
  };
  const srcset = (text, offset, attribute) => {
    // URL tokens may contain commas (notably data URIs); descriptors end at a comma.
    let cursor = 0;
    while (cursor < text.length) {
      while (/[\s,]/u.test(text[cursor] ?? "") && cursor < text.length) cursor++;
      const start = cursor;
      const data = /^data:/iu.test(text.slice(cursor));
      while (cursor < text.length && !/\s/u.test(text[cursor]) && (data || text[cursor] !== ",")) cursor++;
      const value = text.slice(start, cursor).replace(/,+$/u, "");
      add(value, offset + start, attribute);
      if (text[cursor] === "," || text[cursor - 1] === ",") { cursor++; continue; }
      while (cursor < text.length && text[cursor] !== ",") cursor++;
    }
  };
  // Quoted attributes can contain '>'; raw-text elements must not expose fake tags.
  const tags = /<!--[\s\S]*?(?:-->|$)|<([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/giu;
  let tag;
  while ((tag = tags.exec(html)) !== null) {
    if (!tag[1]) continue;
    const name = tag[1].toLowerCase();
    const openingLength = 1 + tag[1].length;
    const attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
    for (const attribute of tag[0].slice(openingLength, -1).matchAll(attributes)) {
      const key = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (value === undefined) continue;
      const valueOffset = attribute[0].length - value.length - (attribute[4] === undefined ? 1 : 0);
      const offset = tag.index + openingLength + attribute.index + valueOffset;
      if (key === "style") css(value, offset, key);
      else if (key === "srcset" && (name === "img" || name === "source")) srcset(value, offset, key);
      else if ((key === "src" && ["img", "source", "video", "audio"].includes(name)) || (key === "poster" && name === "video")) add(value, offset, key);
    }
    if (["style", "script", "textarea", "title"].includes(name)) {
      const closing = new RegExp(`</${name}\\s*>`, "giu");
      closing.lastIndex = tags.lastIndex;
      const end = closing.exec(html);
      if (name === "style") css(html.slice(tags.lastIndex, end?.index ?? html.length), tags.lastIndex, "url");
      tags.lastIndex = end ? closing.lastIndex : html.length;
    }
  }
  return references.sort((a, b) => a.start - b.start);
}
