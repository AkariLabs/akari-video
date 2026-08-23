// HTML オーバーレイのテキストスロット注入。
// プレビュー（overlay-runtime.mount）と書き出し（render-cut rasterize）が、この 1 実装を
// ブラウザへ読み込んで共有する。入力 DOM は変更せず、注入済み clone を返す。
window.akari = window.akari || {};

window.akari.slotParams = (() => {
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function renderTextSlots(root, params) {
    if (!root || typeof root.cloneNode !== "function") {
      throw new TypeError("slot root は cloneNode を持つ必要があります");
    }

    const clone = root.cloneNode(true);
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return clone;
    }

    const slots = [];
    if (clone.nodeType === Node.ELEMENT_NODE && clone.hasAttribute("data-akari-slot")) {
      slots.push(clone);
    }
    if (typeof clone.querySelectorAll === "function") {
      slots.push(...clone.querySelectorAll("[data-akari-slot]"));
    }

    // 入れ子スロットが来ても親の値を最終結果にする。authoring 規約では入れ子を禁止するが、
    // 深い側から処理しておけば「親に params が無く子だけにある」断片も自然に扱える。
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      const slot = slots[index];
      const name = slot.getAttribute("data-akari-slot");
      if (name && hasOwn(params, name) && typeof params[name] === "string") {
        // HTML として解釈しない。params は常にプレーンテキストとして注入する。
        slot.textContent = params[name];
      }
    }
    return clone;
  }

  return { renderTextSlots };
})();
