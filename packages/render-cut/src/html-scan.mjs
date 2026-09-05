// <style> と application/json script は raw text として保持する。その内側の `<!-- ... -->` は
// HTML コメントではなく CSS / JSON の内容なので、外側の HTML コメントだけを除去する。
const HTML_COMMENT_OR_PROTECTED_BLOCK_PATTERN = /<!--[\s\S]*?-->|<style\b[^>]*>[\s\S]*?<\/style\s*>|<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'|application\/json(?=[\s>])))\s*[^>]*>[\s\S]*?<\/script\s*>/giu;

export function stripHtmlComments(html) {
  return String(html ?? "").replace(
    HTML_COMMENT_OR_PROTECTED_BLOCK_PATTERN,
    (token) => token.startsWith("<!--") ? "" : token,
  );
}
