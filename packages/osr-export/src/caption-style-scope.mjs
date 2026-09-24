// OSR の overlay sheet は全字幕を 1 文書に並べる。各断片の通常の CSS 規則だけを
// シート内の字幕順から作る属性で限定する。@font-face / @keyframes と宣言本体は変更しない。
function qualifySelectorList(prelude, root, scope) {
  const selectors = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let quote = null;
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "(") parens += 1;
    else if (char === ")") parens -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    else if (char === "," && parens === 0 && brackets === 0) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors.map(part => {
    const selector = part.trim();
    if (selector.startsWith(".akari-caption__")) return part.replace(selector, `${root} ${selector}`);
    if (/^\.akari-caption(?:--[a-z-]+)?(?=$|[\s>+~.:#\[])/u.test(selector)) {
      return part.replace(selector, selector.replace(
        /^(\.akari-caption(?:--[a-z-]+)?)/u,
        `$1[data-akari-caption-scope="${scope}"]`,
      ));
    }
    // A plain class list is unambiguous: each member must be scoped separately.
    if (selectors.length > 1 && /^\.[_a-zA-Z][\w-]*$/u.test(selector)) {
      return part.replace(selector, `${root} ${selector}`);
    }
    // Unknown selectors are kept verbatim. They must never abort an export.
    return part;
  }).join(",");
}

function scopeCaptionStyle(html, captionIndex) {
  const scope = `c-${Buffer.from(captionIndex).toString("hex")}`;
  const root = `.akari-caption[data-akari-caption-scope="${scope}"]`;
  let malformed = false;
  const scopedHtml = html.replace(/(<style>)([\s\S]*?)(<\/style>)/u, (_match, open, css, close) => {
    let scoped = "";
    let start = 0;
    let depth = 0;
    let blockStart = -1;
    let quote = null;
    let comment = false;
    for (let index = 0; index < css.length; index += 1) {
      const char = css[index];
      const next = css[index + 1];
      if (comment) {
        if (char === "*" && next === "/") { comment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "/" && next === "*") { comment = true; index += 1; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "{") {
        if (depth === 0) blockStart = index;
        depth += 1;
      }
      if (char !== "}") continue;
      if (depth === 0) { malformed = true; break; }
      if (--depth !== 0) continue;
      const rule = css.slice(start, index + 1);
      const header = rule.trimStart();
      if (header.startsWith("@")) {
        scoped += rule;
      } else {
        const prelude = css.slice(start, blockStart);
        scoped += `${qualifySelectorList(prelude, root, scope)}${css.slice(blockStart, index + 1)}`;
      }
      start = index + 1;
    }
    if (malformed || depth !== 0 || comment || quote) { malformed = true; return _match; }
    return `${open}${scoped}${css.slice(start)}${close}`;
  });
  if (malformed) return html;
  return scopedHtml.replace(/^(<div class="akari-caption[^"\n]*")/u,
    `$1 data-akari-caption-scope="${scope}"`);
}

// GPU と共有する buildOsrPage の字幕断片は変更せず、実際に OSR の 1 文書として配信する
// 直前で限定する。style は各 caption root の直下なので、この範囲だけを置換できる。
export function scopeCaptionStylesInSheet(sheetHtml) {
  if (typeof sheetHtml !== "string") return sheetHtml;
  let index = 0;
  return sheetHtml.replace(/<div class="akari-caption[^"\n]*">\s*<style>[\s\S]*?<\/style>/gu,
    (fragment) => scopeCaptionStyle(fragment, String(index++)));
}
