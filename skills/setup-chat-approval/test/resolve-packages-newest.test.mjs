import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePackageFile } from "../bin/resolve-packages.mjs";

const RELATIVE = "creator-root/src/index.mjs";

async function fixture(run) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "akari-packages-newest-"));
  const homeDir = path.join(scratch, "home");
  const from = path.join(scratch, "project", ".claude", "skills", "setup-chat-approval", "bin", "entry.mjs");
  await mkdir(path.dirname(from), { recursive: true });
  try {
    await run({ scratch, homeDir, from, env: {} });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function addCandidate(root, version) {
  const file = path.join(root, "packages", RELATIVE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "export default true;\n");
  if (version !== null) {
    const launcher = root.endsWith(path.join("packages", "akari-launcher", "vendor"))
      ? path.join(root, "..", "package.json")
      : path.join(root, "packages", "akari-launcher", "package.json");
    await mkdir(path.dirname(launcher), { recursive: true });
    await writeFile(launcher, JSON.stringify({ version }));
  }
  return file;
}

async function addShim(homeDir, resources, name = "akari") {
  const shim = path.join(homeDir, ".akari", "cli", "bin", name);
  await mkdir(path.dirname(shim), { recursive: true });
  await writeFile(shim, `exec node "${path.join(resources, "packages", "akari-launcher", "bin", "akari.mjs")}" "$@"\n`);
}

test("古い CLI と新しいデスクトップ版ではデスクトップ版を選ぶ", async () => fixture(async ({ scratch, homeDir, from, env }) => {
  await addCandidate(path.join(homeDir, ".akari", "app"), "0.1.40");
  const resources = path.join(scratch, "Resources");
  const expected = await addCandidate(resources, "0.1.81");
  await addShim(homeDir, resources);
  assert.equal(resolvePackageFile(RELATIVE, { from, env, homeDir }), expected);
}));

test("デスクトップ版だけでも解決できる", async () => fixture(async ({ scratch, homeDir, from, env }) => {
  const resources = path.join(scratch, "Resources");
  const expected = await addCandidate(resources, "0.1.81");
  await addShim(homeDir, resources);
  assert.equal(resolvePackageFile(RELATIVE, { from, env, homeDir }), expected);
}));

test("AKARI_MONOREPO は新しいデスクトップ版より優先する", async () => fixture(async ({ scratch, homeDir, from }) => {
  const monorepo = path.join(scratch, "monorepo");
  const expected = await addCandidate(monorepo, "0.1.10");
  const resources = path.join(scratch, "Resources");
  await addCandidate(resources, "0.1.81");
  await addShim(homeDir, resources);
  assert.equal(resolvePackageFile(RELATIVE, { from, env: { AKARI_MONOREPO: monorepo }, homeDir }), expected);
}));

test("AKARI_INSTALL_DIR があっても既定の CLI インストール先を候補に残す", async () => fixture(async ({ scratch, homeDir, from }) => {
  const expected = await addCandidate(path.join(homeDir, ".akari", "app"), "0.1.81");
  const resources = path.join(scratch, "Resources");
  await addCandidate(resources, "0.1.40");
  await addShim(homeDir, resources);
  assert.equal(resolvePackageFile(RELATIVE, {
    from, env: { AKARI_INSTALL_DIR: path.join(scratch, "missing-install") }, homeDir,
  }), expected);
}));

test("from の祖先は env と新しいデスクトップ版より優先する", async () => fixture(async ({ scratch, homeDir, from }) => {
  const expected = await addCandidate(path.join(scratch, "project"), "0.1.01");
  const monorepo = path.join(scratch, "monorepo");
  await addCandidate(monorepo, "0.1.70");
  const resources = path.join(scratch, "Resources");
  await addCandidate(resources, "0.1.81");
  await addShim(homeDir, resources);
  assert.equal(resolvePackageFile(RELATIVE, { from, env: { AKARI_MONOREPO: monorepo }, homeDir }), expected);
}));

test("暗黙候補では選ばれなかった実在候補の版は選択版より新しくない", async () => {
  const cases = [
    { app: "0.1.40", resources: "0.1.81", vendor: "0.1.81", selected: "resources" },
    { app: "0.1.82", resources: "0.1.81", vendor: "0.1.81", selected: "app" },
    { app: null, resources: "0.1.81-rc.2", vendor: "0.1.81-rc.2", selected: "resources" },
    { app: "0.1.81-rc.2", resources: "0.1.81", vendor: "0.1.81", selected: "resources" },
    { app: null, resources: undefined, vendor: "0.1.81", selected: "vendor" },
    { app: null, resources: null, vendor: null, selected: "app" },
  ];
  for (const item of cases) {
    await fixture(async ({ scratch, homeDir, from, env }) => {
      const resources = path.join(scratch, "Resources");
      const roots = {
        app: path.join(homeDir, ".akari", "app"),
        resources,
        vendor: path.join(resources, "packages", "akari-launcher", "vendor"),
      };
      const files = {};
      for (const [name, root] of Object.entries(roots)) {
        if (item[name] === undefined) continue;
        files[name] = await addCandidate(root, item[name]);
      }
      await addShim(homeDir, resources);
      assert.equal(resolvePackageFile(RELATIVE, { from, env, homeDir }), files[item.selected]);
      const selectedVersion = item[item.selected];
      for (const [name, version] of Object.entries(item)) {
        if (!["app", "resources", "vendor"].includes(name) || name === item.selected || version === undefined) continue;
        // ケースは昇順比較で明示しており、null は読めない版として最古。
        assert.ok(selectedVersion !== null || version === null);
        if (selectedVersion !== null && version !== null) {
          const order = (value) => {
            const [base, pre] = value.split("-");
            return [...base.split(".").map(Number), pre ?? null];
          };
          const left = order(version);
          const right = order(selectedVersion);
          const compare = left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
            || (left[3] === right[3] ? 0 : left[3] === null ? 1 : right[3] === null ? -1 : left[3].localeCompare(right[3], undefined, { numeric: true }));
          assert.ok(compare <= 0, `${name} is newer than ${item.selected}`);
        }
      }
    });
  }
});
