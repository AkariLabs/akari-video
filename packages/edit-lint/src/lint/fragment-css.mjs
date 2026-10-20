import { parseOverlayStyles } from "./overlay-css.mjs";

/**
 * CSS のクラスセレクタと @keyframes 名を断片から集める。
 * 同じ断片を複数クリップで使う場合は衝突ではないので、呼び出し側が断片の同一性で除外する。
 */
export function collectFragmentCssNames(html) {
  const styles = parseOverlayStyles(html);
  const classes = new Set();
  for (const rule of styles.rules) {
    for (const name of classNamesInSelector(rule.selector)) classes.add(name);
  }
  return { classes, keyframes: new Set(styles.keyframes.keys()) };
}

/** セレクタ文字列からクラス名を取り出す。属性セレクタ・文字列・数値は対象外。 */
export function classNamesInSelector(selector) {
  const names = new Set();
  let quote = null;
  let brackets = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "." && brackets === 0) {
      const ident = readCssIdent(selector, index + 1);
      if (ident !== null) {
        names.add(ident.name);
        index = ident.end - 1;
      }
    }
  }
  return names;
}

function readCssIdent(value, start) {
  let index = start;
  let name = "";
  if (value[index] === "-" && value[index + 1] === "-") {
    name = "--";
    index += 2;
  } else if (value[index] === "-") {
    name = "-";
    index += 1;
  }
  if (index >= value.length) return null;
  while (index < value.length) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) {
      const escaped = value[index + 1];
      if (/[\r\n]/u.test(escaped)) return name === "" || name === "-" ? null : { name, end: index };
      name += escaped;
      index += 2;
      continue;
    }
    if (/^[_a-zA-Z0-9-]$/u.test(character) || character.charCodeAt(0) >= 0x80) {
      name += character;
      index += 1;
      continue;
    }
    break;
  }
  if (name === "" || /^[-]?[0-9]/u.test(name)) return null;
  return { name, end: index };
}
