// ビューポート単位（vw / vh / vmin / vmax 系）のステージ基準化
//
// 断片（overlays[].html）の CSS に書いた vw / vh は、ブラウザ仕様どおり「ウィンドウの
// viewport」を基準に解決される。書き出し（packages/render-cut/src/rasterize.mjs）は
// 出力サイズちょうどの viewport（1280x720 なら 1vw = 12.8px）でシートを描くので正しいが、
// プレビューは #overlay-stage を出力 px の論理サイズで作り transform: scale() でペインへ
// 収めるため、ステージの px 寸法とウィンドウ幅が一致せず vw の意味が書き出しとずれる
// （書き出しが正しく、プレビューが嘘をつく。2026-08-31 実機報告）。
//
// 対策（ランタイム側で完結。断片は書き換えない）:
//   1. ステージ要素に --akari-vw / --akari-vh / --akari-vmin / --akari-vmax を
//      出力サイズから定義する（applyStageVariables。例 1280x720 → 12.8px / 7.2px）
//   2. mount 時に断片の <style> と style="" 属性の中の <数値><vw 系単位> を
//        calc(<数値> * var(--akari-vw, 1vw))
//      へ書き換える（applyAll）。断片の要素はステージから継承で受け取るので、
//      ステージの論理サイズ = 出力サイズ基準で解決される
//   断片に <script> は書けない規約（skills/overlay-authoring/SKILL.md）のため、
//   data-mirror / data-akari-split と同じくランタイムが担う。
//
// 書き換えないもの:
//   - @media / @container / @supports 等の at-rule プレリュード（var() が使えない。
//     書き換えると条件式ごと無効になる）
//   - 文字列リテラル・url(...)・コメントの中
//   - 既に書き換え済みの var(--akari-v*, 1vw) のフォールバック部分（= 冪等）
// 対象外（意図的）: 断片内 <script> の window.innerWidth 参照（断片に script は書けない）、
//   SVG のプレゼンテーション属性（vw を書く前例がなく、属性値は CSS 単位を取らない）。
//
// フォールバック `1vw` は、--akari-* を定義しないホスト（このパッケージを使う別シェル）で
// 従来どおりの挙動へ退避するためのもの。本番のプレビューでは必ず定義される。
(function (root, factory) {
  const api = factory();
  if (typeof window !== "undefined") {
    window.akari = window.akari || {};
    window.akari.viewportUnits = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VARIABLES = ["--akari-vw", "--akari-vh", "--akari-vmin", "--akari-vmax"];

  // <数値><単位>。単位は長い順に並べる（"dvmin" を "vmin" や "vi" に取られない）。
  // 直前が識別子文字・ピリオド・ハイフンなら除外（`.hero-10vw` のようなクラス名や
  // `foo-1vw` を壊さない）。直後が識別子文字なら除外（`10vwx`）。単位は大小無視（CSS 準拠）。
  const UNIT_PATTERN =
    /(?<![\w.\-])(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(dvmin|dvmax|svmin|svmax|lvmin|lvmax|vmin|vmax|dvw|dvh|svw|svh|lvw|lvh|dvi|dvb|svi|svb|lvi|lvb|vw|vh|vi|vb)(?![\w\-%])/gi;

  // 「単位が一つも無ければ触らない」ための軽い前置き判定（大きな style 属性 =
  // data: URI 入りの background-image 等を毎回走査しないため）。
  const QUICK_TEST = /\d\s*(?:[dsl]?v(?:w|h|min|max|i|b))\b/i;

  // 書き換えを禁じる区間。左から順に最初に現れたものを採用するので、文字列の中の `/*` や
  // コメントの中の `"` に惑わされない。
  //   コメント / 二重引用文字列 / 単一引用文字列 / 引用なし url() /
  //   at-rule プレリュード（@xxx … { または ;）/ 書き換え済み var(--akari-v*, …)
  const PROTECTED_PATTERN =
    /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|url\(\s*[^"')\s][^)]*\)|@[\w-]+[^{;]*[{;]|var\(\s*--akari-v(?:w|h|min|max)\s*,[^)]*\)/g;

  function protectedRanges(text) {
    const ranges = [];
    PROTECTED_PATTERN.lastIndex = 0;
    let match;
    while ((match = PROTECTED_PATTERN.exec(text)) !== null) {
      ranges.push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) PROTECTED_PATTERN.lastIndex += 1;
    }
    return ranges;
  }

  // 単位 → ステージ変数の軸。d/s/l 接頭辞（dynamic/small/large viewport）は固定寸の
  // ステージでは区別がないので落とす。vi/vb（論理）は横書き前提で vw/vh に寄せる。
  function axisOf(unit) {
    const base = unit.toLowerCase().replace(/^[dsl]/, "");
    if (base === "vi") return "vw";
    if (base === "vb") return "vh";
    return base;
  }

  /**
   * CSS テキスト（<style> の中身、または style 属性の値）の vw 系単位を
   * `calc(<数値> * var(--akari-<軸>, <元の単位>))` へ書き換えて返す。
   * 単位が無ければ入力をそのまま返す（参照同一）。冪等。
   */
  function rewriteCssText(text) {
    if (typeof text !== "string" || text.length === 0) return text;
    if (!QUICK_TEST.test(text)) return text;
    const ranges = protectedRanges(text);
    let rangeIndex = 0;
    return text.replace(UNIT_PATTERN, (whole, number, unit, offset) => {
      while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= offset) rangeIndex += 1;
      if (rangeIndex < ranges.length && ranges[rangeIndex][0] <= offset) return whole;
      return `calc(${number} * var(--akari-${axisOf(unit)}, 1${unit}))`;
    });
  }

  /**
   * root 配下の <style> 要素と style="" 属性を書き換える（root 自身は対象外 —
   * ランタイムが作るコンテナで、断片の内容はその子）。書き換えた節点の数を返す。
   */
  function applyAll(root) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let changed = 0;
    for (const style of root.querySelectorAll("style")) {
      const before = style.textContent;
      const after = rewriteCssText(before);
      if (after !== before) {
        style.textContent = after;
        changed += 1;
      }
    }
    for (const element of root.querySelectorAll("[style]")) {
      const before = element.getAttribute("style");
      const after = rewriteCssText(before);
      if (after !== before) {
        element.setAttribute("style", after);
        changed += 1;
      }
    }
    return changed;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  /** 出力サイズ（edit.json output）からステージ変数の値を作る。 */
  function stageVariables(output) {
    const width = finiteNumber(output && output.width, 1280);
    const height = finiteNumber(output && output.height, 720);
    return {
      "--akari-vw": `${width / 100}px`,
      "--akari-vh": `${height / 100}px`,
      "--akari-vmin": `${Math.min(width, height) / 100}px`,
      "--akari-vmax": `${Math.max(width, height) / 100}px`,
    };
  }

  /** ステージ要素（出力 px 論理サイズの座標系のルート）にステージ変数を定義する。 */
  function applyStageVariables(element, output) {
    if (!element || !element.style) return;
    for (const [name, value] of Object.entries(stageVariables(output))) {
      element.style.setProperty(name, value);
    }
  }

  return { rewriteCssText, applyAll, stageVariables, applyStageVariables, VARIABLES };
});
