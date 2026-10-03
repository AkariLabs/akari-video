import { extractFragmentAssetReferences, scanFragmentCssUrls } from "./fragment-assets.mjs";
import { htmlTags, rawTextElements, startsWithFold, stripCssComments, stripHtmlComments } from "./html-scan.mjs";

const TEXT_TRANSFORM = /text-transform/giu;
const CONTENT = /content/giu;
const DATA_URI = /data:/giu;
const FONT_FACE = /@font-face/giu;
function findFold(source, pattern, start) {
  pattern.lastIndex = start;
  return pattern.exec(source)?.index ?? -1;
}

const entities = new Map(Object.entries({"AElig":"Æ","Aacute":"Á","Acirc":"Â","Agrave":"À","Alpha":"Α","Aring":"Å","Atilde":"Ã","Auml":"Ä","Beta":"Β","Ccedil":"Ç","Chi":"Χ","Dagger":"‡","Delta":"Δ","ETH":"Ð","Eacute":"É","Ecirc":"Ê","Egrave":"È","Epsilon":"Ε","Eta":"Η","Euml":"Ë","Gamma":"Γ","Iacute":"Í","Icirc":"Î","Igrave":"Ì","Iota":"Ι","Iuml":"Ï","Kappa":"Κ","Lambda":"Λ","Mu":"Μ","Ntilde":"Ñ","Nu":"Ν","OElig":"Œ","Oacute":"Ó","Ocirc":"Ô","Ograve":"Ò","Omega":"Ω","Omicron":"Ο","Oslash":"Ø","Otilde":"Õ","Ouml":"Ö","Phi":"Φ","Pi":"Π","Prime":"″","Psi":"Ψ","Rho":"Ρ","Scaron":"Š","Sigma":"Σ","THORN":"Þ","Tau":"Τ","Theta":"Θ","Uacute":"Ú","Ucirc":"Û","Ugrave":"Ù","Upsilon":"Υ","Uuml":"Ü","Xi":"Ξ","Yacute":"Ý","Yuml":"Ÿ","Zeta":"Ζ","aacute":"á","acirc":"â","acute":"´","aelig":"æ","agrave":"à","alefsym":"ℵ","alpha":"α","amp":"&","and":"∧","ang":"∠","aring":"å","asymp":"≈","atilde":"ã","auml":"ä","bdquo":"„","beta":"β","brvbar":"¦","bull":"•","cap":"∩","ccedil":"ç","cedil":"¸","cent":"¢","chi":"χ","circ":"ˆ","clubs":"♣","cong":"≅","copy":"©","crarr":"↵","cup":"∪","curren":"¤","dArr":"⇓","dagger":"†","darr":"↓","deg":"°","delta":"δ","diams":"♦","divide":"÷","eacute":"é","ecirc":"ê","egrave":"è","empty":"∅","emsp":" ","ensp":" ","epsilon":"ε","equiv":"≡","eta":"η","eth":"ð","euml":"ë","euro":"€","exist":"∃","fnof":"ƒ","forall":"∀","frac12":"½","frac14":"¼","frac34":"¾","frasl":"⁄","gamma":"γ","ge":"≥","gt":">","hArr":"⇔","harr":"↔","hearts":"♥","hellip":"…","iacute":"í","icirc":"î","iexcl":"¡","igrave":"ì","image":"ℑ","infin":"∞","int":"∫","iota":"ι","iquest":"¿","isin":"∈","iuml":"ï","kappa":"κ","lArr":"⇐","lambda":"λ","lang":"〈","laquo":"«","larr":"←","lceil":"⌈","ldquo":"“","le":"≤","lfloor":"⌊","lowast":"∗","loz":"◊","lrm":"‎","lsaquo":"‹","lsquo":"‘","lt":"<","macr":"¯","mdash":"—","micro":"µ","middot":"·","minus":"−","mu":"μ","nabla":"∇","nbsp":" ","ndash":"–","ne":"≠","ni":"∋","not":"¬","notin":"∉","nsub":"⊄","ntilde":"ñ","nu":"ν","oacute":"ó","ocirc":"ô","oelig":"œ","ograve":"ò","oline":"‾","omega":"ω","omicron":"ο","oplus":"⊕","or":"∨","ordf":"ª","ordm":"º","oslash":"ø","otilde":"õ","otimes":"⊗","ouml":"ö","para":"¶","part":"∂","permil":"‰","perp":"⊥","phi":"φ","pi":"π","piv":"ϖ","plusmn":"±","pound":"£","prime":"′","prod":"∏","prop":"∝","psi":"ψ","quot":"\"","rArr":"⇒","radic":"√","rang":"〉","raquo":"»","rarr":"→","rceil":"⌉","rdquo":"”","real":"ℜ","reg":"®","rfloor":"⌋","rho":"ρ","rlm":"‏","rsaquo":"›","rsquo":"’","sbquo":"‚","scaron":"š","sdot":"⋅","sect":"§","shy":"­","sigma":"σ","sigmaf":"ς","sim":"∼","spades":"♠","sub":"⊂","sube":"⊆","sum":"∑","sup":"⊃","sup1":"¹","sup2":"²","sup3":"³","supe":"⊇","szlig":"ß","tau":"τ","there4":"∴","theta":"θ","thetasym":"ϑ","thinsp":" ","thorn":"þ","tilde":"˜","times":"×","trade":"™","uArr":"⇑","uacute":"ú","uarr":"↑","ucirc":"û","ugrave":"ù","uml":"¨","upsih":"ϒ","upsilon":"υ","uuml":"ü","weierp":"℘","xi":"ξ","yacute":"ý","yen":"¥","yuml":"ÿ","zeta":"ζ","zwj":"‍","zwnj":"‌"}));
const safety = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~「」『』【】（）［］｛｝、。，．・：；！？ー〜―…";

function decodeHtml(value) {
  if (!value.includes("&")) return value;
  const parts = [];
  let cursor = 0;
  while (cursor < value.length) {
    const at = value.indexOf("&", cursor);
    if (at < 0) break;
    parts.push(value.slice(cursor, at));
    let end = -1;
    for (let i = at + 1; i < value.length && i <= at + 40; i++) {
      if (value.charCodeAt(i) === 59) { end = i; break; }
    }
    if (end < 0) { parts.push("&"); cursor = at + 1; continue; }
    const name = value.slice(at + 1, end);
    if (/^[A-Za-z][A-Za-z0-9]*$/u.test(name)) parts.push(entities.get(name) ?? "");
    else if (/^#(?:[xX][0-9a-fA-F]+|\d+)$/u.test(name)) {
      const hex = name[1]?.toLowerCase() === "x";
      const cp = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      parts.push(cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�");
    } else parts.push(value.slice(at, end + 1));
    cursor = end + 1;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}

function decodeCss(value) {
  return value.replace(/\\(?:([0-9a-f]{1,6})\s?|([\s\S]))/giu, (_, hex, char) => {
    if (!hex) return char === "\n" ? "" : char;
    const cp = Number.parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "�";
  });
}

function add(set, value) {
  for (const char of value) {
    const cp = char.codePointAt(0);
    if (set.has(cp) || cp <= 32 || cp >= 0x7f && cp <= 0xa0 || cp === 0x1680
      || cp >= 0x2000 && cp <= 0x200a || cp === 0x2028 || cp === 0x2029
      || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0xfeff
      || /\p{Default_Ignorable_Code_Point}/u.test(char)) continue;
    set.add(cp);
  }
}

function strings(value, output) {
  if (typeof value === "string") add(output, value);
  else if (Array.isArray(value)) for (const child of value) strings(child, output);
  else if (value && typeof value === "object") for (const child of Object.values(value)) strings(child, output);
}

function attributes(tag) {
  const result = Object.create(null);
  let cursor = 1;
  if (tag[cursor] === "/") cursor++;
  while (cursor < tag.length && !isHtmlWhitespace(tag.charCodeAt(cursor)) && tag[cursor] !== ">") cursor++;
  while (cursor < tag.length - 1) {
    while (isHtmlWhitespace(tag.charCodeAt(cursor))) cursor++;
    if (tag[cursor] === "/" || tag[cursor] === ">") break;
    const start = cursor;
    while (cursor < tag.length && !isHtmlWhitespace(tag.charCodeAt(cursor)) && !"=/>".includes(tag[cursor])) cursor++;
    if (cursor === start) { cursor++; continue; }
    const name = tag.slice(start, cursor).toLowerCase();
    while (isHtmlWhitespace(tag.charCodeAt(cursor))) cursor++;
    let value = "";
    if (tag[cursor] === "=") {
      cursor++;
      while (isHtmlWhitespace(tag.charCodeAt(cursor))) cursor++;
      const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor++] : null;
      const valueStart = cursor;
      if (quote) {
        const end = tag.indexOf(quote, cursor);
        cursor = end < 0 ? tag.length - 1 : end;
        value = tag.slice(valueStart, cursor);
        if (tag[cursor] === quote) cursor++;
      } else {
        while (cursor < tag.length && !isHtmlWhitespace(tag.charCodeAt(cursor)) && tag[cursor] !== ">") cursor++;
        value = tag.slice(valueStart, cursor);
      }
    }
    result[name] = decodeHtml(value);
  }
  return result;
}

function isHtmlWhitespace(cp) {
  return cp === 9 || cp === 10 || cp === 12 || cp === 13 || cp === 32;
}

function transformModes(css, modes) {
  let cursor = 0;
  while (cursor < css.length) {
    const at = findFold(css, TEXT_TRANSFORM, cursor);
    if (at < 0) break;
    cursor = at + 14;
    if (/[\w-]/u.test(css[at - 1] ?? "") || /[\w-]/u.test(css[cursor] ?? "")) continue;
    while (isHtmlWhitespace(css.charCodeAt(cursor))) cursor++;
    if (css[cursor++] !== ":") continue;
    while (isHtmlWhitespace(css.charCodeAt(cursor))) cursor++;
    const start = cursor;
    while (cursor < css.length && /[a-z-]/iu.test(css[cursor])) cursor++;
    const mode = css.slice(start, cursor).toLowerCase();
    if (["uppercase", "lowercase", "capitalize", "full-width"].includes(mode)) modes.add(mode);
    if (cursor === start) cursor++;
  }
}

function cssContent(css, attrs, output, inline = false) {
  const source = stripCssComments(css);
  let cursor = 0;
  while (cursor < source.length) {
    const at = findFold(source, CONTENT, cursor);
    if (at < 0) break;
    cursor = at + 7;
    if (/[\w-]/u.test(source[at - 1] ?? "") || /[\w-]/u.test(source[cursor] ?? "")) continue;
    let previous = at - 1;
    while (previous >= 0 && /\s/u.test(source[previous])) previous--;
    if (previous < 0 ? !inline : source[previous] !== "{" && source[previous] !== ";") continue;
    while (/\s/u.test(source[cursor] ?? "")) cursor++;
    if (source[cursor++] !== ":") continue;
    let end = cursor;
    let quote = null;
    let depth = 0;
    while (end < source.length) {
      const char = source[end];
      if (char === "\\") { end += 2; continue; }
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if ((char === ";" || char === "}") && depth === 0) break;
      end++;
    }
    const value = source.slice(cursor, end);
    cursor = end < source.length ? end + 1 : source.length;
    for (let at = 0; at < value.length;) {
      const quote = value[at];
      if (quote === '"' || quote === "'") {
        const start = ++at;
        while (at < value.length) {
          if (value[at] === "\\") { at += 2; continue; }
          if (value[at] === quote) break;
          at++;
        }
        add(output, decodeCss(value.slice(start, at)));
        at++;
      } else if (startsWithFold(value, "attr(", at)) {
        const end = value.indexOf(")", at + 5);
        if (end < 0) break;
        const key = value.slice(at + 5, end).trim().toLowerCase();
        const values = attrs[key] ?? [];
        for (const value of Array.isArray(values) ? values : [values]) add(output, value);
        at = end + 1;
      } else at++;
    }
  }
}

function visibleText(html, output) {
  const raw = [
    ...rawTextElements(html, "style"),
    ...rawTextElements(html, "script"),
  ].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let rawIndex = 0;
  for (const item of htmlTags(html)) {
    while (rawIndex < raw.length && raw[rawIndex].end <= item.start) rawIndex++;
    if (raw[rawIndex] && item.start > raw[rawIndex].start && item.start < raw[rawIndex].end) continue;
    if (item.start > cursor) add(output, decodeHtml(html.slice(cursor, item.start)));
    cursor = item.end;
    if (raw[rawIndex]?.start === item.start) cursor = raw[rawIndex].end;
  }
  if (cursor < html.length) add(output, decodeHtml(html.slice(cursor)));
}

function sourceWithoutData(html, output) {
  const include = segment => {
    add(output, segment);
    add(output, decodeHtml(segment));
    add(output, decodeCss(segment));
  };
  let cursor = 0;
  while (cursor < html.length) {
    const at = findFold(html, DATA_URI, cursor);
    if (at < 0) { include(html.slice(cursor)); break; }
    include(html.slice(cursor, at));
    let end = at + 5;
    while (end < html.length) {
      const cp = html.charCodeAt(end);
      if (isHtmlWhitespace(cp) || cp === 34 || cp === 39 || cp === 60 || cp === 62 || cp === 41) break;
      end++;
    }
    cursor = end;
  }
}

export function collectFragmentCodepoints(html, { params, vars, mode = "render" } = {}) {
  const codepoints = new Set();
  const clean = stripHtmlComments(html);
  const attrs = Object.create(null);
  let dynamic = false;
  const transforms = new Set();
  let rootSeen = false;
  const raw = [...rawTextElements(clean, "style"), ...rawTextElements(clean, "script")]
    .sort((a, b) => a.start - b.start);
  let rawIndex = 0;
  for (const tag of htmlTags(clean)) {
    while (rawIndex < raw.length && raw[rawIndex].end <= tag.start) rawIndex++;
    if (raw[rawIndex] && tag.start > raw[rawIndex].start && tag.start < raw[rawIndex].end) continue;
    if (!/^<[a-z]/iu.test(tag.text)) continue;
    const name = /^<([\w:-]+)/u.exec(tag.text)?.[1]?.toLowerCase();
    const parsed = attributes(tag.text);
    for (const [key, value] of Object.entries(parsed)) (attrs[key] ??= []).push(value);
    if (!rootSeen && parsed["data-akari-font-chars"]) add(codepoints, parsed["data-akari-font-chars"]);
    rootSeen = true;
    if (parsed["text-transform"]) transformModes(`text-transform:${parsed["text-transform"]};`, transforms);
    if (parsed.style) transformModes(`;${parsed.style}`, transforms);
    if (parsed.style) cssContent(parsed.style, parsed, codepoints, true);
    if (name === "script" && parsed.type?.toLowerCase() !== "application/json") dynamic = true;
  }
  for (const block of rawTextElements(clean, "style")) {
    const css = clean.slice(block.bodyStart, block.bodyEnd);
    cssContent(css, attrs, codepoints);
    transformModes(css, transforms);
  }
  for (const block of rawTextElements(clean, "script")) {
    const opening = clean.slice(block.start, block.bodyStart);
    if (attributes(opening).type?.toLowerCase() !== "application/json") continue;
    try { strings(JSON.parse(clean.slice(block.bodyStart, block.bodyEnd)), codepoints); } catch { /* Invalid declarations are checked elsewhere. */ }
  }
  visibleText(clean, codepoints);
  strings(params, codepoints);
  strings(vars, codepoints);
  if (transforms.size) {
    for (const cp of [...codepoints]) {
      const char = String.fromCodePoint(cp);
      if (transforms.has("uppercase") || transforms.has("capitalize")) add(codepoints, char.toUpperCase());
      if (transforms.has("lowercase")) add(codepoints, char.toLowerCase());
      if (transforms.has("full-width") && cp >= 0x21 && cp <= 0x7e) add(codepoints, String.fromCodePoint(cp + 0xfee0));
    }
  }
  if (mode === "source") {
    sourceWithoutData(html, codepoints);
    add(codepoints, safety);
    for (let cp = 33; cp <= 126; cp++) codepoints.add(cp);
  }
  return { codepoints, hasDynamicScript: dynamic };
}

export function fragmentFontFaces(html, htmlPath) {
  const faces = [];
  const clean = stripHtmlComments(html);
  for (const style of rawTextElements(clean, "style")) {
    const css = stripCssComments(clean.slice(style.bodyStart, style.bodyEnd));
    let cursor = 0;
    while (cursor < css.length) {
      const at = findFold(css, FONT_FACE, cursor);
      if (at < 0) break;
      const start = css.indexOf("{", at + 10);
      if (start < 0) break;
      const end = css.indexOf("}", start + 1);
      if (end < 0) break;
      cursor = end + 1;
      const body = css.slice(start + 1, end);
      const wrapped = `<style>${body}</style>`;
      const local = extractFragmentAssetReferences(wrapped, htmlPath).filter(ref => ref.role === "font");
      const data = scanFragmentCssUrls(wrapped).values.filter(url => /^data:/iu.test(url));
      const family = /font-family\s*:\s*(["']?)([^;"']{1,256})\1\s*(?:;|$)/iu.exec(body)?.[2]?.trim() ?? "";
      faces.push({ family, sources: [...local, ...data.map(raw => ({ raw, data: raw }))] });
    }
  }
  return faces;
}
