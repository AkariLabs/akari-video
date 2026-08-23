import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/slot-params.js"), "utf8");

function fakeRoot(slotEntries) {
  const slots = slotEntries.map(([name, text]) => ({
    textContent: text,
    getAttribute(attribute) {
      return attribute === "data-akari-slot" ? name : null;
    },
  }));
  return {
    nodeType: 11,
    cloneNode() {
      return fakeRoot(slots.map(slot => [slot.getAttribute("data-akari-slot"), slot.textContent]));
    },
    querySelectorAll() {
      return slots;
    },
    slots,
  };
}

test("shared slot renderer returns a clone, keeps defaults, and assigns params via textContent", () => {
  const context = { window: {}, Node: { ELEMENT_NODE: 1 } };
  vm.runInNewContext(source, context);
  const root = fakeRoot([["title", "既定"], ["subtitle", "既定サブ"]]);
  const rendered = context.window.akari.slotParams.renderTextSlots(root, {
    title: "<b>タグではない文字列</b>",
  });

  assert.notEqual(rendered, root);
  assert.equal(root.slots[0].textContent, "既定", "input DOM must stay unchanged");
  assert.equal(rendered.slots[0].textContent, "<b>タグではない文字列</b>");
  assert.equal(rendered.slots[1].textContent, "既定サブ");
});
