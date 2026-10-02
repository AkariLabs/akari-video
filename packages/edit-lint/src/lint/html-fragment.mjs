export function inspectHtmlFragment(html) {
  const workingHtml = maskHtmlFragmentContents(html);
  const tokens = workingHtml.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g) ?? [];
  const stack = [];
  let rootCount = 0;
  let rootAttributes = {};
  let hasTopLevelText = false;
  let unbalanced = false;
  let cursor = 0;

  for (const token of tokens) {
    const index = workingHtml.indexOf(token, cursor);
    if (
      index > cursor
      && stack.length === 0
      && workingHtml.slice(cursor, index).trim() !== ""
    ) {
      hasTopLevelText = true;
    }
    cursor = index + token.length;
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const closing = /^<\//.test(token);
    const nameMatch = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (closing) {
      if (stack.at(-1) !== name) unbalanced = true;
      else stack.pop();
      continue;
    }
    if (stack.length === 0) {
      rootCount += 1;
      if (rootCount === 1) rootAttributes = parseHtmlAttributes(token);
    }
    if (!isVoidElement(name) && !/\/\s*>$/.test(token)) stack.push(name);
  }
  if (workingHtml.slice(cursor).trim() !== "" && stack.length === 0) hasTopLevelText = true;
  if (stack.length > 0) unbalanced = true;
  return { rootCount, rootAttributes, hasTopLevelText, unbalanced };
}

export function maskHtmlFragmentContents(html) {
  const mask = (content) => content.replace(/[^\r\n]/g, " ");
  return html.replace(
    /<!--([\s\S]*?)-->|(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_whole, comment, scriptOpen, scriptContent, scriptClose, styleOpen, styleContent, styleClose) => {
      if (comment !== undefined) return `<!--${mask(comment)}-->`;
      if (scriptOpen !== undefined) return `${scriptOpen}${mask(scriptContent)}${scriptClose}`;
      return `${styleOpen}${mask(styleContent)}${styleClose}`;
    },
  );
}

export function parseHtmlAttributes(openingTag) {
  const attributes = {};
  const head = openingTag.replace(/^<\s*[A-Za-z][\w:-]*/, "").replace(/\/?>$/, "");
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of head.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function isVoidElement(name) {
  return new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]).has(name);
}

