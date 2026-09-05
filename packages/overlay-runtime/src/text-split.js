// テキスト分割プリミティブ
//
// 契約: 内部リポ akari-video-internal のテロップ運動文法契約 v0（2026-08-15）
//
// 断片は `data-akari-split="bunsetsu"` のような宣言だけを持ち、分割済みの
// `<span class="akari-u" style="--i:N">` で出荷する。ランタイムは
//   - mount 時に「宣言はあるが未分割」の要素を分割する（出荷漏れの安全網）
//   - テキスト打ち替えのたびに分割し直す（--i を振り直す）
// を担う。断片側に <script> は書かない（telop.md の FORBIDDEN 級ルール）。
//
// 断片はこの `--i` を使って stagger を CSS だけで表現する:
//   [data-akari-active] .foo .akari-u{
//     animation: foo__in var(--anim-duration,500ms) var(--anim-easing) both paused;
//     animation-delay: calc(var(--i) * var(--anim-stagger, 150ms));
//   }
// --anim-easing の既定値とイージング語彙（--ease-*）・対象別既定尺（--anim-duration-*）は
// src/motion-vocab.css（正典）。断片は cubic-bezier を直書きせず名前で呼ぶ。
// ★ [data-akari-active] ゲートの中で宣言すること。ゲートを外すと分割数ぶん
//   CSS animation がドキュメントに常駐し、getAnimations() のコストが跳ねる
//   （実測: 1,200 断片 × 8 分割 = 9,600 本で 221ms/tick。契約 §6）。
window.akari = window.akari || {};

window.akari.textSplit = (() => {
  const UNIT_CLASS = "akari-u";
  const ATTR = "data-akari-split";
  const MODES = new Set(["none", "chars", "bunsetsu", "words", "lines"]);

  let warnedNoBudoux = false;

  function hasIntlSegmenter() {
    return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
  }

  // bunsetsu（表示単位）の近似。BudouX が読み込まれていない環境向けの退避で、
  // 精度は落ちる（holdout 実測: BudouX 85% に対し 65%。契約 §5）。
  const HIRA = /^[ぁ-んゝゞー〜]+$/;
  const CLOSESYM = /^[、。！？!?…‥]+$/;
  const PARTICLE =
    /^(は|が|の|に|を|で|へ|と|や|も|から|まで|より|ね|よ|ぞ|ぜ|か|な|さ|ので|のに|けど|けれど|ば|たら|なら|ても|でも|しか|だけ|こそ|など|ながら|つつ|には|とは|では|による|という|として|について|のか|かも)$/;
  const AUX =
    /^(だ|です|ます|でした|ました|だった|である|そう|ない|たい|れる|られる|せる|させる|ようだ|らしい|みたい|でしょう|ましょう|う|よう|た|て|ず|なく|なかった|ください)$/;
  const SUFFIX =
    /^(さん|ちゃん|くん|君|様|氏|先生|社|店|駅|線|県|市|区|町|村|部|課|中|後|前|目|的|性|化|用|型|系|風|級|感|力|者|ら|たち|など|等|方|側)$/;

  function bunsetsuFallback(text) {
    if (!hasIntlSegmenter()) return [text];
    const raw = [...new Intl.Segmenter("ja", { granularity: "word" }).segment(text)]
      .map((s) => s.segment)
      .filter((s) => s !== "");
    const out = [];
    let cur = null;
    const start = (w) => {
      cur = { text: w, headHira: HIRA.test(w), closed: false, hard: false, tail: /[ぁ-ん]$/.test(w) };
      out.push(cur);
    };
    for (const w of raw) {
      if (!cur) {
        start(w);
        continue;
      }
      if (CLOSESYM.test(w)) {
        cur.text += w;
        cur.closed = true;
        cur.hard = true;
        continue;
      }
      if (!cur.hard && PARTICLE.test(w)) {
        cur.text += w;
        cur.closed = true;
        continue;
      }
      if (!cur.hard && (AUX.test(w) || SUFFIX.test(w))) {
        cur.text += w;
        continue;
      }
      const hira = HIRA.test(w);
      if (!cur.closed && !cur.headHira) {
        if (hira) {
          cur.text += w;
          cur.tail = true;
          continue;
        }
        if (!cur.tail) {
          cur.text += w;
          cur.tail = /[ぁ-ん]$/.test(w);
          continue;
        }
      }
      start(w);
    }
    return out.map((c) => c.text);
  }

  /**
   * テキストを分割単位の配列にする。
   * @param {string} text
   * @param {"none"|"chars"|"bunsetsu"|"words"|"lines"} mode
   * @returns {string[]}
   */
  function segment(text, mode) {
    if (typeof text !== "string" || text === "") return [];
    if (!MODES.has(mode) || mode === "none") return [text];
    if (mode === "lines") return text.split("\n");
    if (mode === "chars") return [...text];
    if (mode === "words") {
      if (!hasIntlSegmenter()) return [text];
      return [...new Intl.Segmenter("ja", { granularity: "word" }).segment(text)]
        .map((s) => s.segment)
        .filter((s) => s !== "");
    }
    // bunsetsu
    const budoux = window.akari?._budoux;
    if (budoux?.parse) return budoux.parse(text);
    if (!warnedNoBudoux) {
      warnedNoBudoux = true;
      console.warn(
        "[akari.textSplit] budoux-ja-bundle.js が未読み込みのため、" +
          'split="bunsetsu" は精度の落ちる近似で動作します' +
          "（実測 85% → 65%）。vendor/budoux-ja-bundle.js を読み込んでください。"
      );
    }
    return bunsetsuFallback(text);
  }

  function isSplitHost(element) {
    return element instanceof Element && element.hasAttribute(ATTR);
  }

  /** 分割済みの要素から素のテキストへ戻す（編集開始時に使う）。 */
  function collapse(element) {
    if (!isSplitHost(element)) return;
    const text = element.textContent ?? "";
    element.replaceChildren(document.createTextNode(text));
    element.removeAttribute("data-akari-split-units");
  }

  /**
   * 1 要素を分割して `<span class="akari-u" style="--i:N">` へ置き換える。
   * 既に同じ結果へ分割済みなら DOM を触らない（tick ごとに呼んでも安全）。
   * @returns {number} 分割された単位数
   */
  function apply(element) {
    if (!isSplitHost(element)) return 0;
    const mode = element.getAttribute(ATTR) || "none";
    const text = element.textContent ?? "";
    const units = segment(text, mode);

    // 冪等性: 現在の子が既に望む分割と一致していれば何もしない
    const current = element.children;
    if (
      current.length === units.length &&
      element.getAttribute("data-akari-split-units") === String(units.length) &&
      [...current].every(
        (el, i) => el.classList?.contains(UNIT_CLASS) && el.textContent === units[i]
      )
    ) {
      return units.length;
    }

    const frag = document.createDocumentFragment();
    units.forEach((unit, i) => {
      const span = document.createElement("span");
      span.className = UNIT_CLASS;
      span.style.setProperty("--i", String(i));
      // 分割で改行・空白が潰れないようにする（断片側 CSS への依存を減らす）
      span.style.whiteSpace = "pre-wrap";
      span.style.display = "inline-block";
      span.textContent = unit;
      frag.appendChild(span);
    });
    element.replaceChildren(frag);
    element.style.setProperty("--n", String(units.length));
    element.setAttribute("data-akari-split-units", String(units.length));
    return units.length;
  }

  /**
   * root 配下の全ての [data-akari-split] を分割する。
   * @param {ParentNode} root
   * @returns {{elements: number, units: number}}
   */
  function applyAll(root) {
    if (!root?.querySelectorAll) return { elements: 0, units: 0 };
    let elements = 0;
    let units = 0;
    for (const el of root.querySelectorAll(`[${ATTR}]`)) {
      const n = apply(el);
      if (n > 0) {
        elements += 1;
        units += n;
      }
    }
    return { elements, units };
  }

  /** 要素、またはその祖先のうち最も近い分割ホストを返す。 */
  function closestHost(element) {
    return element instanceof Element ? element.closest(`[${ATTR}]`) : null;
  }

  return { segment, apply, applyAll, collapse, closestHost, isSplitHost, UNIT_CLASS, ATTR };
})();
