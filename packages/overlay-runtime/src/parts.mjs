const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/** data-akari-part の名札を HTML ソース上の出現順で返す。 */
export function scanHtmlParts(htmlText) {
  const parts = [];
  for (const token of tokenizeHtml(String(htmlText ?? ""))) {
    if (token.closing || token.ignored) continue;
    const attribute = token.attributes.find(entry => entry.name === "data-akari-part");
    if (attribute?.value !== undefined) {
      parts.push({ id: attribute.value, order: parts.length });
    }
  }
  return parts;
}

/**
 * 袋の走査名札を写しへ投影し、同じ part の明示子で置き換える。
 * internal-model の children と、生の契約語彙 items のどちらも受け付ける。
 */
export function projectBagChildren(bagItem, parts) {
  const explicitChildren = Array.isArray(bagItem?.children)
    ? bagItem.children
    : Array.isArray(bagItem?.items) ? bagItem.items : [];
  const explicitByPart = new Map();
  for (const child of explicitChildren) {
    const part = child?.source?.part;
    if (typeof part === "string" && !explicitByPart.has(part)) explicitByPart.set(part, child);
  }

  const exclude = new Set(Array.isArray(bagItem?.source?.exclude) ? bagItem.source.exclude : []);
  const inserted = new Set();
  const projected = [];
  for (const entry of Array.isArray(parts) ? parts : []) {
    if (!entry || typeof entry.id !== "string") continue;
    const explicit = explicitByPart.get(entry.id);
    if (explicit) {
      if (!inserted.has(explicit)) {
        projected.push(explicit);
        inserted.add(explicit);
      }
      continue;
    }
    if (exclude.has(entry.id)) continue;
    projected.push({
      id: `${String(bagItem?.id ?? "")}#${entry.id}`,
      at: finiteNumber(bagItem?.at, 0),
      duration: Math.max(0, finiteNumber(bagItem?.duration, 0)),
      parentId: bagItem?.id,
      source: {
        ...(isRecord(bagItem?.source) ? bagItem.source : {}),
        part: entry.id,
      },
      declaration: {},
    });
  }

  for (const child of explicitChildren) {
    if (!inserted.has(child)) projected.push(child);
  }
  return projected;
}

/**
 * 対象 part だけを可視にするクローンマスクを付ける。
 * 戻り値は [html, { missing }]。対象が無いときだけ入力をそのまま返す。
 */
export function applyPartMask(htmlText, partId, overrides = {}) {
  const html = String(htmlText ?? "");
  const wanted = String(partId ?? "");
  const tokens = tokenizeHtml(html);
  const targets = tokens.filter(token => !token.closing && !token.ignored
    && token.attributes.some(attribute =>
      attribute.name === "data-akari-part" && attribute.value === wanted));
  if (targets.length === 0) return [html, { missing: true }];

  const styleText = serializeInlineStyle(overrides.style);
  const hasText = Object.prototype.hasOwnProperty.call(overrides, "text")
    && overrides.text !== undefined;
  let modified = html;
  for (const token of [...targets].sort((left, right) => right.start - left.start)) {
    let opening = modified.slice(token.start, token.end);
    if (styleText) opening = appendInlineStyle(opening, token, styleText);
    if (hasText && token.closeStart !== undefined) {
      modified = modified.slice(0, token.end)
        + escapeText(overrides.text)
        + modified.slice(token.closeStart);
    }
    modified = modified.slice(0, token.start) + opening + modified.slice(token.end);
  }

  const attributeId = escapeAttribute(wanted);
  const selectorId = escapeCssString(wanted);
  const rule = `[data-akari-part-mask="${selectorId}"] [data-akari-part]:not([data-akari-part="${selectorId}"]){visibility:hidden !important}`;
  return [
    `<div data-akari-part-mask="${attributeId}"><style>${rule}</style>${modified}</div>`,
    { missing: false },
  ];
}

/**
 * internal edit の HTML / group 木を、既存 renderer が消費できる overlay レコードへ射影する。
 * readHtml(ref, item) は同期関数で、ファイル参照を断片本文へ解決する。
 */
export function expandBagOverlays(internal, readHtml = value => String(value ?? "")) {
  const records = [];
  for (const track of internal?.tracks ?? []) {
    for (const item of track?.items ?? []) {
      expandItem(item, track, emptyGroupContext(), readHtml, records);
    }
  }
  return records;
}

function expandItem(item, track, group, readHtml, records) {
  if (!item || itemHidden(item)) return;
  if (item.source?.kind === "group") {
    const declaration = declarationOf(item);
    const ownTransform = transformOf(declaration.transform);
    const itemStart = finiteNumber(item.at, 0);
    const itemEnd = itemStart + Math.max(0, finiteNumber(item.duration, 0));
    const next = {
      transform: composeTransforms(group.transform, ownTransform),
      hasTransform: group.hasTransform || hasTransform(declaration.transform),
      opacity: group.opacity * finiteNumber(declaration.opacity, 1),
      hasOpacity: group.hasOpacity || declaration.opacity !== undefined,
      blend: declaration.blend ?? group.blend,
      clipStart: Math.max(group.clipStart, itemStart),
      clipEnd: Math.min(group.clipEnd, itemEnd),
    };
    if (!(next.clipEnd > next.clipStart)) return;
    for (const child of item.children ?? item.items ?? []) {
      expandItem(child, track, next, readHtml, records);
    }
    return;
  }
  if (item.source?.kind !== "html") return;

  const declaration = declarationOf(item);
  const htmlReference = String(item.source.html ?? declaration.html ?? "");
  const htmlText = String(readHtml(htmlReference, item) ?? "");
  const parts = scanHtmlParts(htmlText);
  const explicitChildren = Array.isArray(item.children) ? item.children
    : Array.isArray(item.items) ? item.items : [];
  const exclude = Array.isArray(item.source.exclude) ? item.source.exclude : [];
  const isBag = explicitChildren.length > 0 || exclude.length > 0 || parts.length > 0;

  if (typeof item.source.part === "string") {
    const [masked] = applyPartMask(htmlText, item.source.part, item.source);
    const record = overlayRecord(item, track, group, {
      html: masked,
      part: item.source.part,
      parentId: item.parentId,
    });
    if (record) records.push(record);
    return;
  }

  if (!isBag || (explicitChildren.length === 0 && exclude.length === 0)) {
    const record = overlayRecord(item, track, group, { html: htmlReference });
    if (record) records.push(record);
    return;
  }

  const visibleChildren = projectBagChildren(item, parts);
  for (const child of visibleChildren) {
    if (itemHidden(child)) continue;
    const part = child?.source?.part;
    if (typeof part !== "string") {
      expandItem(child, track, group, readHtml, records);
      continue;
    }
    const childReference = String(child.source?.html ?? htmlReference);
    const childHtml = childReference === htmlReference
      ? htmlText
      : String(readHtml(childReference, child) ?? "");
    const [masked] = applyPartMask(childHtml, part, child.source);
    const record = bagChildRecord(item, child, track, group, masked, part);
    if (record) records.push(record);
  }
}

function overlayRecord(item, track, group, extra) {
  const declaration = declarationOf(item);
  const declaredStart = finiteNumber(item.at, 0);
  const declaredDuration = Math.max(0, finiteNumber(item.duration, 0));
  const declaredEnd = declaredStart + declaredDuration;
  const clippedStart = Math.max(group.clipStart, declaredStart);
  const clippedEnd = Math.min(group.clipEnd, declaredEnd);
  const startClipped = !Object.is(clippedStart, declaredStart);
  const endClipped = !Object.is(clippedEnd, declaredEnd);
  const start = startClipped ? clippedStart : declaredStart;
  const duration = startClipped || endClipped ? clippedEnd - clippedStart : declaredDuration;
  if (duration < 0) return null;
  const ownTransform = transformOf(declaration.transform);
  const transform = composeTransforms(group.transform, ownTransform);
  const hasResolvedTransform = group.hasTransform || hasTransform(declaration.transform);
  const opacity = group.opacity * finiteNumber(declaration.opacity, 1);
  return cleanRecord({
    ...declaration,
    id: String(item.id ?? declaration.id ?? ""),
    html: extra.html,
    start,
    duration,
    ...(hasResolvedTransform ? { transform } : {}),
    ...(group.hasOpacity || declaration.opacity !== undefined ? { opacity } : {}),
    ...(declaration.blend ?? group.blend) !== undefined
      ? { blend: declaration.blend ?? group.blend } : {},
    ...(extra.part !== undefined ? { part: extra.part } : {}),
    ...(extra.parentId !== undefined ? { parentId: extra.parentId } : {}),
  });
}

function bagChildRecord(bag, child, track, group, html, part) {
  const bagDeclaration = declarationOf(bag);
  const childDeclaration = declarationOf(child);
  const bagStart = finiteNumber(bag.at, 0);
  const bagEnd = bagStart + Math.max(0, finiteNumber(bag.duration, 0));
  const declaredStart = finiteNumber(child.at, bagStart);
  const declaredDuration = Math.max(0, finiteNumber(child.duration, finiteNumber(bag.duration, 0)));
  const declaredEnd = declaredStart + declaredDuration;
  const clippedStart = Math.max(group.clipStart, bagStart, declaredStart);
  const clippedEnd = Math.min(group.clipEnd, bagEnd, declaredEnd);
  const startClipped = !Object.is(clippedStart, declaredStart);
  const endClipped = !Object.is(clippedEnd, declaredEnd);
  const start = startClipped ? clippedStart : declaredStart;
  const duration = startClipped || endClipped ? clippedEnd - clippedStart : declaredDuration;
  if (!(duration > 0)) return null;

  const resolvedTransformDeclaration = mergeTransforms(
    bagDeclaration.transform,
    childDeclaration.transform,
  );
  const resolvedTransform = composeTransforms(group.transform, transformOf(resolvedTransformDeclaration));
  const hasResolvedTransform = group.hasTransform
    || hasTransform(bagDeclaration.transform)
    || hasTransform(childDeclaration.transform);
  const localOpacity = childDeclaration.opacity ?? bagDeclaration.opacity;
  const opacity = group.opacity * finiteNumber(localOpacity, 1);
  const blend = childDeclaration.blend ?? bagDeclaration.blend ?? group.blend;
  const vars = mergeRecords(bagDeclaration.vars, childDeclaration.vars);
  const params = mergeRecords(bagDeclaration.params ?? bag.source?.params,
    childDeclaration.params ?? child.source?.params);

  return cleanRecord({
    ...bagDeclaration,
    ...childDeclaration,
    id: String(child.id ?? `${String(bag.id ?? "")}#${part}`),
    html,
    start,
    duration,
    ...(hasResolvedTransform ? { transform: resolvedTransform } : {}),
    ...(group.hasOpacity || localOpacity !== undefined ? { opacity } : {}),
    ...(blend !== undefined ? { blend } : {}),
    ...(vars !== undefined ? { vars } : {}),
    ...(params !== undefined ? { params } : {}),
    part,
    parentId: String(bag.id ?? ""),
  });
}

function emptyGroupContext() {
  return {
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    hasTransform: false,
    opacity: 1,
    hasOpacity: false,
    blend: undefined,
    clipStart: Number.NEGATIVE_INFINITY,
    clipEnd: Number.POSITIVE_INFINITY,
  };
}

function composeTransforms(parent, child) {
  const angle = finiteNumber(parent.rotate, 0) * Math.PI / 180;
  const scale = finiteNumber(parent.scale, 1);
  const childX = finiteNumber(child.x, 0);
  const childY = finiteNumber(child.y, 0);
  return {
    x: finiteNumber(parent.x, 0) + scale * (Math.cos(angle) * childX - Math.sin(angle) * childY),
    y: finiteNumber(parent.y, 0) + scale * (Math.sin(angle) * childX + Math.cos(angle) * childY),
    scale: scale * finiteNumber(child.scale, 1),
    rotate: finiteNumber(parent.rotate, 0) + finiteNumber(child.rotate, 0),
  };
}

function mergeTransforms(parent, child) {
  const result = { ...(isRecord(parent) ? parent : {}), ...(isRecord(child) ? child : {}) };
  return Object.keys(result).length > 0 ? result : undefined;
}

function transformOf(value) {
  return {
    x: finiteNumber(value?.x, 0),
    y: finiteNumber(value?.y, 0),
    scale: finiteNumber(value?.scale, 1),
    rotate: finiteNumber(value?.rotate, 0),
  };
}

function hasTransform(value) {
  return isRecord(value) && ["x", "y", "scale", "rotate"].some(key => value[key] !== undefined);
}

function declarationOf(item) {
  return isRecord(item?.declaration) ? item.declaration : isRecord(item) ? item : {};
}

function itemHidden(item) {
  return item?.hidden === true || declarationOf(item).hidden === true;
}

function mergeRecords(parent, child) {
  if (!isRecord(parent) && !isRecord(child)) return undefined;
  return { ...(isRecord(parent) ? parent : {}), ...(isRecord(child) ? child : {}) };
}

function cleanRecord(record) {
  for (const key of ["at", "children", "items", "hidden"]) delete record[key];
  return record;
}

function serializeInlineStyle(style) {
  if (!isRecord(style)) return "";
  return Object.entries(style)
    .map(([name, value]) => `${escapeCssToken(name)}:${escapeCssToken(String(value))}`)
    .join(";");
}

function appendInlineStyle(opening, token, styleText) {
  const style = token.attributes.find(attribute => attribute.name === "style");
  if (style && style.valueStart !== undefined && style.valueEnd !== undefined) {
    const relativeStart = style.valueStart - token.start;
    const relativeEnd = style.valueEnd - token.start;
    if (style.quote) {
      const separator = style.value && !style.value.endsWith(";") ? ";" : "";
      return opening.slice(0, relativeEnd) + separator + styleText + opening.slice(relativeEnd);
    }
    const joined = `${style.value ?? ""}${style.value ? ";" : ""}${styleText}`;
    return opening.slice(0, relativeStart)
      + `"${escapeAttribute(joined)}"`
      + opening.slice(relativeEnd);
  }
  const insertion = opening.lastIndexOf("/>") >= 0 ? opening.lastIndexOf("/>") : opening.lastIndexOf(">");
  return opening.slice(0, insertion) + ` style="${escapeAttribute(styleText)}"` + opening.slice(insertion);
}

function escapeCssToken(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\3B ")
    .replaceAll('"', "\\22 ")
    .replaceAll("'", "\\27 ")
    .replaceAll("\n", "\\A ")
    .replaceAll("\r", "\\D ");
}

function escapeCssString(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("<", "\\3C ")
    .replaceAll(">", "\\3E ")
    .replaceAll("/", "\\2F ")
    .replaceAll("&", "\\26 ")
    .replaceAll("\n", "\\A ")
    .replaceAll("\r", "\\D ");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tokenizeHtml(html) {
  const tokens = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    const end = findTagEnd(html, start + 1);
    if (end < 0) break;
    const raw = html.slice(start, end + 1);
    const header = raw.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/iu);
    if (!header) {
      cursor = end + 1;
      continue;
    }
    const closing = header[1] === "/";
    const name = header[2].toLowerCase();
    if (!closing && (name === "script" || name === "style")) {
      const closePattern = new RegExp(`<\\s*\\/\\s*${name}\\s*>`, "igu");
      closePattern.lastIndex = end + 1;
      const close = closePattern.exec(html);
      cursor = close ? close.index + close[0].length : html.length;
      continue;
    }
    const attributes = closing ? [] : parseAttributes(raw, start, header[0].length);
    tokens.push({
      start,
      end: end + 1,
      name,
      closing,
      selfClosing: /\/\s*>$/u.test(raw) || VOID_ELEMENTS.has(name),
      attributes,
      ignored: false,
    });
    cursor = end + 1;
  }

  const stack = [];
  for (const token of tokens) {
    if (!token.closing && !token.selfClosing) {
      stack.push(token);
      continue;
    }
    if (!token.closing) continue;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].name !== token.name) continue;
      const opening = stack[index];
      stack.splice(index);
      opening.closeStart = token.start;
      opening.closeEnd = token.end;
      break;
    }
  }
  return tokens;
}

function findTagEnd(html, cursor) {
  let quote = "";
  for (let index = cursor; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseAttributes(raw, absoluteStart, headerLength) {
  const attributes = [];
  let cursor = headerLength;
  while (cursor < raw.length - 1) {
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    if (raw[cursor] === "/" || raw[cursor] === ">" || cursor >= raw.length - 1) break;
    const nameStart = cursor;
    while (cursor < raw.length && !/[\s=/>]/u.test(raw[cursor])) cursor += 1;
    const name = raw.slice(nameStart, cursor).toLowerCase();
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    let value;
    let valueStart;
    let valueEnd;
    let quote = "";
    if (raw[cursor] === "=") {
      cursor += 1;
      while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
      if (raw[cursor] === '"' || raw[cursor] === "'") {
        quote = raw[cursor];
        cursor += 1;
        valueStart = cursor;
        while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
        valueEnd = cursor;
        value = raw.slice(valueStart, valueEnd);
        if (raw[cursor] === quote) cursor += 1;
      } else {
        valueStart = cursor;
        while (cursor < raw.length && !/[\s>]/u.test(raw[cursor])) cursor += 1;
        valueEnd = cursor;
        value = raw.slice(valueStart, valueEnd).replace(/\/$/u, "");
        valueEnd -= raw.slice(valueStart, valueEnd).endsWith("/") ? 1 : 0;
      }
    }
    if (name) {
      attributes.push({
        name,
        value,
        quote,
        valueStart: valueStart === undefined ? undefined : absoluteStart + valueStart,
        valueEnd: valueEnd === undefined ? undefined : absoluteStart + valueEnd,
      });
    }
  }
  return attributes;
}
