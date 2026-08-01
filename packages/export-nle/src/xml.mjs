// 依存ゼロの XML 組み立てヘルパ。writer 2 本（fcpxml / xmeml）で共用する。

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// タグ名・属性・子要素から整形済み XML を組む。children は文字列（既整形）か
// node オブジェクトの配列。text は要素内テキスト（escape される）。
export function element(name, attributes = {}, children = [], text = null) {
  return { name, attributes, children, text };
}

export function serialize(node, indent = 0) {
  const pad = "  ".repeat(indent);
  const attrs = Object.entries(node.attributes)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  if (node.text !== null && node.text !== undefined) {
    return `${pad}<${node.name}${attrs}>${escapeXml(node.text)}</${node.name}>`;
  }
  const children = (node.children ?? []).filter(Boolean);
  if (children.length === 0) return `${pad}<${node.name}${attrs}/>`;
  const body = children
    .map((child) => (typeof child === "string" ? child : serialize(child, indent + 1)))
    .join("\n");
  return `${pad}<${node.name}${attrs}>\n${body}\n${pad}</${node.name}>`;
}

export function document(root, doctype = null) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  return `${header}\n${doctype ? `${doctype}\n` : ""}${serialize(root)}\n`;
}
