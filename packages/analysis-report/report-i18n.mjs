import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getLanguage } from "../i18n/index.mjs";

const catalogRoot = new URL("../i18n/locales/", import.meta.url);
const catalogCache = new Map();

export function reportLanguage(value) {
  if (value === undefined) return getLanguage();
  if (value !== "ja" && value !== "en") throw new Error("--lang must be ja or en");
  return value;
}

export function reportCatalog(namespace, language) {
  const key = `${language}/${namespace}`;
  if (!catalogCache.has(key)) catalogCache.set(key, JSON.parse(readFileSync(fileURLToPath(new URL(`${key}.json`, catalogRoot)), "utf8")));
  return catalogCache.get(key);
}

export function reportText(namespace, key, language, params = {}) {
  const value = reportCatalog(namespace, language)[key];
  if (value === undefined) throw new Error(`Missing report translation: ${key}`);
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (match, name) => params[name] === undefined ? match : String(params[name]));
}

export function reportDataStrings(value) {
  if (typeof value === "string") return /[\u3000-\u9fff\uff00-\uffef]/u.test(value)
    ? [value, value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")]
    : [];
  if (Array.isArray(value)) return value.flatMap(reportDataStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(reportDataStrings);
  return [];
}

// Translate the authored shell before inserting user data. The Japanese path is returned
// without any change, preserving the byte representation of existing reports.
export function localizeReportTemplate(template, namespace, language, protectedStrings = []) {
  if (language === "ja") return template.replace(/ data-i18n="[^"]+"/gu, "");
  const ja = reportCatalog(namespace, "ja");
  const en = reportCatalog(namespace, "en");
  let rendered = template.replace('<html lang="ja">', '<html lang="en">');
  // Decision-card answer values are persisted identifiers, even when their
  // template labels are localized. Character references retain the same DOM value.
  rendered = rendered.replace(/data-array-value="([^"]*)"/gu, (attribute, value) => `data-array-value="${value.replace(/[\u3040-\u30ff\u3400-\u9fff]/gu, (character) => `&#${character.codePointAt(0)};`)}"`);
  const tokens = [];
  for (const value of [...new Set(protectedStrings)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const token = `__AKARI_PROTECTED_${tokens.length}__`;
    if (rendered.includes(value)) {
      rendered = rendered.replaceAll(value, token);
      tokens.push([token, value]);
    }
  }
  for (const [key, source] of Object.entries(ja).sort((left, right) => right[1].length - left[1].length)) {
    if (source && en[key] !== undefined) rendered = rendered.replaceAll(source, en[key]);
  }
  const dictionary = JSON.stringify(en).replace(/</gu, "\\u003c");
  rendered = rendered.replace("</body>", `  <script type="application/json" id="akari-report-i18n">${dictionary}</script>\n  <script>\n    (() => {\n      const messages = JSON.parse(document.getElementById('akari-report-i18n').textContent);\n      for (const node of document.querySelectorAll('[data-i18n]')) {\n        if (node.hasAttribute('data-mount') || node.hasAttribute('data-field')) continue;\n        const value = messages[node.getAttribute('data-i18n')];\n        if (value !== undefined && !value.includes('{')) node.textContent = value;\n      }\n    })();\n  </script>\n</body>`);
  rendered = rendered.replace(/[\u3040-\u30ff\u3400-\u9fff]/gu, (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
  for (const [token, value] of tokens) rendered = rendered.replaceAll(token, value);
  return rendered;
}
