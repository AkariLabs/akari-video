import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "interaction.js"), "utf8");

test("実寸ルートの gesture は背面へ抜けず、空白選択解除も同じ pointerdown で確定する", () => {
  assert.match(source, /fragmentRootCoversContainer/);
  assert.match(source, /!isFragmentRoot \|\| !fragmentRootCoversContainer\(element, container\)/);
  assert.match(source, /return isSelectable\(eventTargetOverlay\) \? eventTargetOverlay : null/);
  assert.doesNotMatch(source, /const containers = Array\.from\(stage\.children\)/);
  assert.match(source, /if \(selectedOverlay && stage && Number\.isFinite\(event\.clientX\)/);
  assert.match(source, /clearSelection\(\);\s*}\s*}\s*return;\s*}\s*\n\s*selectOverlay\(container\)/);
});
