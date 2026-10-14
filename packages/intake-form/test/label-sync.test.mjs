import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// intake のタスクラベルは packages/schemas/intake.schema.json の x-akari-labels が単一の正典。
// akari-surfaces の intake-labels.ts と本パッケージの intake-form-template.html は
// ビルド経路の制約による手動ミラーのため、drift をこのテストで機械検出する
// （ラベルを変えるときは 3 箇所を揃える — どれか 1 箇所だけ変えるとここが落ちる）。

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");

function schemaLabels(schema) {
  const found = (function walk(node) {
    if (node && typeof node === "object") {
      if (node["x-akari-labels"]) return node["x-akari-labels"];
      for (const value of Object.values(node)) {
        const hit = walk(value);
        if (hit) return hit;
      }
    }
    return undefined;
  })(schema);
  assert.ok(found, "intake.schema.json に x-akari-labels が見つからない");
  return Object.entries(found).filter(([key]) => !key.startsWith("$"));
}

test("x-akari-labels の手動ミラー 2 箇所（intake-labels.ts / intake-form-template.html）が schema と同期している", async () => {
  const schema = JSON.parse(
    await readFile(join(repoRoot, "packages", "schemas", "intake.schema.json"), "utf8")
  );
  const entries = schemaLabels(schema);
  assert.ok(entries.length >= 5, `ラベルが少なすぎる: ${entries.length}`);

  const surfacesMirror = await readFile(
    join(repoRoot, "apps", "shell", "extensions", "akari-surfaces", "src", "common", "intake-labels.ts"),
    "utf8"
  );
  const htmlMirror = await readFile(join(packageRoot, "intake-form-template.html"), "utf8");
  const japaneseCatalog = JSON.parse(await readFile(
    join(repoRoot, "packages", "i18n", "locales", "ja", "surfaces.json"), "utf8"
  ));

  for (const [id, label] of entries) {
    assert.ok(surfacesMirror.includes(`'${id}'`), `intake-labels.ts に ID '${id}' が無い`);
    const key = surfacesMirror.match(new RegExp(`(?:'${id}'|${id}): t\\('([^']+)'\\)`))?.[1];
    assert.ok(key, `intake-labels.ts に ID '${id}' の翻訳キーが無い`);
    assert.equal(japaneseCatalog[key], label, `intake-labels.ts の ID '${id}' が schema と異なる`);
    assert.ok(htmlMirror.includes(label), `intake-form-template.html にラベル「${label}」が無い`);
  }
});
