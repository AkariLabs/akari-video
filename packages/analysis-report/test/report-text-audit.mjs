export const EAST_ASIAN_FIXED_TEXT = /[\u3000-\u9fff\uff00-\uffef]/u;

function stripJavaScriptComments(source) {
  let result = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote !== null) {
      result += char;
      if (char === "\\" && next !== undefined) result += source[++index];
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      result += char;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length - 1 && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") result += "\n";
        index += 1;
      }
      index += 1;
    } else {
      result += char;
    }
  }
  return result;
}

export function auditedReportText(html, { dataIds = [], allowedDataPatterns = [] } = {}) {
  let text = html.replace(/<!--[\s\S]*?-->/gu, "");
  for (const id of dataIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    text = text.replace(new RegExp(`<script[^>]*id="${escaped}"[^>]*>[\\s\\S]*?<\\/script>`, "gu"), "");
  }
  text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/giu, (whole, open, body, close) =>
    /type="application\/json"/iu.test(open) ? whole : `${open}${stripJavaScriptComments(body)}${close}`);
  text = text.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/giu, (whole, open, body, close) =>
    `${open}${body.replace(/\/\*[\s\S]*?\*\//gu, "")}${close}`);
  text = text.replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const pattern of allowedDataPatterns) {
    if (!text.includes(pattern)) throw new Error(`Expected data-reading pattern was not found: ${pattern}`);
    text = text.replaceAll(pattern, "");
  }
  return text;
}
