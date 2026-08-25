import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs, RenderInputError } from "../src/render-inputs.mjs";
import { createImmutableRenderReceipt } from "../src/render-receipt.mjs";
import { readRenderEdit } from "../src/internal-render.mjs";
import {
  CAPTION_FONT_FILE_URL,
  CAPTION_FONT_REPOSITORY_RELATIVE_PATH,
  resolveCanonicalCaptionFontAsset,
} from "../src/caption-font.mjs";
import { renderResolvedSingleLineCaption } from "../src/captions.mjs";

async function withProject(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-render-receipt-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function file(root, relative, contents = relative) {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

function fixtureEdit() {
  return {
    version: 0,
    output: { width: 1920, height: 1080, fps: 30, look: { lut: "looks/custom.cube", intensity: 1 } },
    source: {
      path: "assets/source.mp4",
      proxy: null,
      chroma_key: { color: "0x00ff00", background: "assets/background.png" },
    },
    cuts: [{ in: 0, out: 1 }],
    overlays: [{ id: "hero", html: "overlays/hero.html", start: 0, duration: 1 }],
    layers: [{ id: "layer", kind: "baked", src: "assets/layer.mov", t: 0, duration: 1 }],
    audio: {
      bgm: { path: "audio/bgm.wav" },
      sfx: [{ path: "audio/sfx.wav", t: 0 }],
      narration: [{ id: "n-1", path: "audio/narration.wav", t: 0, provenance: { provider: "human" } }],
    },
    thumbnail: { path: "assets/thumb.png" },
  };
}

async function prepareInputs(root, edit) {
  for (const relative of [
    "assets/source.mp4", "assets/background.png", "assets/layer.mov", "assets/thumb.png",
    "audio/bgm.wav", "audio/sfx.wav", "audio/narration.wav", "looks/custom.cube",
    "models/scene.glb", "models/environment.hdr", "models/texture.png", "captions.json",
  ]) await file(root, relative);
  const descriptor = {
    model: "models/scene.glb",
    environment: { map: "models/environment.hdr" },
    materialOverrides: { Screen: { texture: "models/texture.png" } },
  };
  await file(
    root,
    "overlays/hero.html",
    `<div>hero</div><script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script>`,
  );
  await file(root, "edit.json", `${JSON.stringify(edit, null, 2)}\n`);
  const raw = JSON.parse(await readFile(join(root, "edit.json"), "utf8"));
  return readRenderEdit(raw, join(root, ".akari", "render-tmp")).edit;
}

async function prepareReceiptOptions(root, { captionFontAsset = null } = {}) {
  const edit = await prepareInputs(root, fixtureEdit());
  const editText = await readFile(join(root, "edit.json"), "utf8");
  const declaredInputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit, editText, captionFontAsset });
  const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
  await file(root, ".akari/lint.json", '{"version":1,"inputs":{},"verdict":"pass","findings":[],"skipped":[]}\n');
  await file(root, "review.json", '{"version":0,"annotations":[]}\n');
  const outputPath = await file(root, "exports/final.mp4", "artifact");
  return {
    projectRoot: root,
    declaredInputs,
    inputSnapshot,
    outputPath,
    ffprobe: { duration_seconds: 1 },
    plan: { output: "exports/final.mp4", commands: {} },
    verify: { verdict: "pass" },
    tools: { node: "v22", ffmpeg: "ffmpeg fixture", ffprobe: "ffprobe fixture" },
    createdAt: "2026-08-03T00:00:00.000Z",
  };
}

async function fakeCaptionFontRepository(root, contents = "font-v1") {
  const repositoryRoot = join(root, "font-repository");
  await file(root, "font-repository/packages/render-cut/package.json", "{}\n");
  await file(root, `font-repository/${CAPTION_FONT_REPOSITORY_RELATIVE_PATH}`, contents);
  return { repositoryRoot, asset: resolveCanonicalCaptionFontAsset({ repositoryRoot }) };
}

// P0 2026-08-21 render-path-unification: fixtureEdit()'s sole cut (v0's implicit single source)
// declares a chroma_key WITH a background image -- packages/edit-store/src/internal-model.ts's
// needsLayersEngine routes that to the 'cuts' engine specifically because a declared background
// can only be honored there (plan.mjs's appendMultiSourceChromaKey replaces the keyed pixels with
// it; the layers engine has no background-replacement mode, only genuine transparency -- see
// layers.mjs's own comment next to its chroma_key step). fixtureEdit()'s v1 layers[] "layer" item
// (a plain baked clip, no distinguishing feature) migrates to plain source.kind:'media', which
// also lands on 'cuts' now (same rule: no blend / chroma_key / keyframed perspective). Both items
// end up in the legacy-projected edit.cuts[], and edit.layers[] is empty -- so "chroma-background:
// main"/"source:main" stay exactly as before, and the former layers[] clip is now declared as
// "source:l-1" (it is used by a cut now) instead of "layer:layer".
test("declared-input enumerator covers every path-backed render input", async () => {
  await withProject(async (root) => {
    const edit = await prepareInputs(root, fixtureEdit());
    const inputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit });
    assert.deepEqual(inputs.map((input) => input.role), [
      "audio:bgm",
      "audio:narration:n-1",
      "audio:sfx:0",
      "caption",
      "chroma-background:main",
      "edit",
      "lut",
      "overlay:hero",
      "overlay:hero:environment",
      "overlay:hero:model",
      "overlay:hero:texture:Screen",
      "source:l-1",
      "source:main",
      "thumbnail",
    ]);
  });
});

test("caption renderer and receipt enumerator share one canonical font binding only when used", async () => {
  await withProject(async (root) => {
    const edit = await prepareInputs(root, fixtureEdit());
    const defaultAsset = resolveCanonicalCaptionFontAsset();
    assert.equal(defaultAsset.file_url, CAPTION_FONT_FILE_URL);
    assert.match(renderResolvedSingleLineCaption("字幕"), new RegExp(escapeRegex(defaultAsset.file_url), "u"));

    const withoutFont = await enumerateDeclaredRenderInputs({ projectRoot: root, edit });
    assert.equal(withoutFont.some(input => input.role === "caption-font"), false);
    const withFont = await enumerateDeclaredRenderInputs({ projectRoot: root, edit, captionFontAsset: defaultAsset });
    const input = withFont.find(value => value.role === "caption-font");
    assert.equal(input.path, `akari:${CAPTION_FONT_REPOSITORY_RELATIVE_PATH}`);
    const [hashed] = (await hashDeclaredRenderInputs([input]));
    assert.equal(hashed.scope, "akari");
    assert.ok(hashed.bytes > 0);
    assert.match(hashed.sha256, /^[a-f0-9]{64}$/u);
  });
});

test("caption font resolver rejects missing, escaping, and unsupported topologies", async () => {
  await withProject(async (root) => {
    const unsupported = join(root, "unsupported-font-root");
    await mkdir(unsupported);
    assert.throws(() => resolveCanonicalCaptionFontAsset({ repositoryRoot: unsupported }), /unsupported.*topology/u);

    const missing = join(root, "missing-font-root");
    await file(root, "missing-font-root/packages/render-cut/package.json", "{}\n");
    assert.throws(() => resolveCanonicalCaptionFontAsset({ repositoryRoot: missing }), /font is unavailable/u);

    const escaping = join(root, "escaping-font-root");
    await file(root, "escaping-font-root/packages/render-cut/package.json", "{}\n");
    const external = await file(root, "outside-font.ttf", "outside");
    const lexical = join(escaping, CAPTION_FONT_REPOSITORY_RELATIVE_PATH);
    await mkdir(join(lexical, ".."), { recursive: true });
    await symlink(external, lexical);
    assert.throws(() => resolveCanonicalCaptionFontAsset({ repositoryRoot: escaping }), /cannot escape|regular checkout asset/u);
  });
});

test("undeclared HTML assets, path escape, and symlink escape are refused", async () => {
  await withProject(async (root) => {
    const edit = await prepareInputs(root, fixtureEdit());
    await file(root, "overlays/hero.html", '<img src="https://example.com/a.png">');
    await assert.rejects(
      enumerateDeclaredRenderInputs({ projectRoot: root, edit }),
      (error) => error instanceof RenderInputError && /undeclared local\/network/u.test(error.message),
    );

    // P0 2026-08-21 render-path-unification: enumerateDeclaredRenderInputs processes edit.sources
    // (filtered to ids edit.cuts[] actually references) before edit.overlays[] -- so this escape
    // check only proves anything if it fires before the still-broken hero.html above does. Which
    // source id that is now depends on classification (packages/edit-store/src/internal-model.ts's
    // needsLayersEngine), not a fixed array index -- fixtureEdit()'s chroma_key-declaring source
    // now renders through the layers engine instead of cuts, so it is no longer the one edit.cuts[]
    // references. Resolve the id edit.cuts[] actually uses instead of assuming edit.sources[0].
    const cutsSource = edit.sources.find((source) => source.id === edit.cuts[0].src);
    cutsSource.path = "../outside.mp4";
    await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot: root, edit }), /escapes the project root/u);

    cutsSource.path = "assets/escape.mp4";
    await symlink("/etc/hosts", join(root, "assets", "escape.mp4"));
    await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot: root, edit }), /not a regular project file/u);
  });
});

test("a missing optional narration is recorded as an absence sentinel", async () => {
  await withProject(async (root) => {
    const edit = await prepareInputs(root, fixtureEdit());
    await rm(join(root, "audio", "narration.wav"));
    const inputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit });
    const narration = inputs.find((input) => input.role === "audio:narration:n-1");
    assert.equal(narration.missing, true);
    const hashed = await hashDeclaredRenderInputs(inputs);
    const receiptInput = hashed.find((input) => input.role === "audio:narration:n-1");
    assert.equal(receiptInput.state, "absent");
    assert.equal(receiptInput.bytes, 0);
    assert.match(receiptInput.sha256, /^[a-f0-9]{64}$/u);
  });
});

test("verified render receipt is complete, content-addressed, and immutable", async () => {
  await withProject(async (root) => {
    const options = await prepareReceiptOptions(root);
    const first = await createImmutableRenderReceipt(options);
    const second = await createImmutableRenderReceipt(options);
    assert.equal(first.path, second.path);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.payload.inputs.length, options.declaredInputs.length);
    assert.equal(first.payload.output.sha256.length, 64);
    assert.equal(first.payload.lint_sha256.length, 64);
    assert.equal(first.payload.review_sha256.length, 64);
    assert.equal(first.payload.plan_sha256.length, 64);
    assert.equal(first.payload.verify.verdict, "pass");
    assert.equal((await readFile(join(root, first.path), "utf8")).includes("self_hash"), false);

    await assert.rejects(
      createImmutableRenderReceipt({ ...options, verify: { verdict: "fail" } }),
      /requires verify.verdict pass/u,
    );
  });
});

test("source, caption, and overlay mutation after planning prevents receipt creation", async (t) => {
  for (const [name, path] of [
    ["edit", "edit.json"],
    ["source", "assets/source.mp4"],
    ["caption", "captions.json"],
    ["overlay", "overlays/hero.html"],
  ]) {
    await t.test(name, async () => {
      await withProject(async (root) => {
        const options = await prepareReceiptOptions(root);
        await writeFile(join(root, path), `mutated-${name}\n`, "utf8");
        await assert.rejects(createImmutableRenderReceipt(options), /render inputs changed during rendering/u);
        const receiptDirectory = join(root, ".akari", "reports", "render-receipts");
        assert.deepEqual(await readdir(receiptDirectory), []);
      });
    });
  }
});

test("an unreferenced rendered source append does not invalidate the receipt", async () => {
  await withProject(async (root) => {
    const options = await prepareReceiptOptions(root);
    const editPath = join(root, "edit.json");
    const current = JSON.parse(await readFile(editPath, "utf8"));
    current.sources.push({ id: "rendered-output", path: "exports/other-run.mp4", proxy: null });
    await writeFile(editPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

    const receipt = await createImmutableRenderReceipt(options);
    assert.equal(receipt.payload.verify.verdict, "pass");
    assert.equal((await readFile(join(root, receipt.path), "utf8")).length > 0, true);
  });
});

test("an unreferenced rendered source removal does not invalidate the receipt", async () => {
  await withProject(async (root) => {
    const options = await prepareReceiptOptions(root);
    const editPath = join(root, "edit.json");
    const currentText = await readFile(editPath, "utf8");
    const consumed = JSON.parse(currentText);
    consumed.sources.push({ id: "rendered-output", path: "exports/lost-run.mp4", proxy: null });
    const consumedText = `${JSON.stringify(consumed, null, 2)}\n`;
    await writeFile(editPath, consumedText, "utf8");
    options.declaredInputs.find((input) => input.role === "edit").text = consumedText;
    options.inputSnapshot = await hashDeclaredRenderInputs(
      options.declaredInputs,
      { useConsumedText: true },
    );
    await writeFile(editPath, currentText, "utf8");

    const receipt = await createImmutableRenderReceipt(options);
    assert.equal(receipt.payload.verify.verdict, "pass");
    assert.equal((await readFile(join(root, receipt.path), "utf8")).length > 0, true);
  });
});

test("a valid edit declaration mutation still invalidates the receipt", async () => {
  await withProject(async (root) => {
    const options = await prepareReceiptOptions(root);
    const editPath = join(root, "edit.json");
    const current = JSON.parse(await readFile(editPath, "utf8"));
    current.output.width += 1;
    await writeFile(editPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

    await assert.rejects(
      createImmutableRenderReceipt(options),
      /render inputs changed during rendering: edit:edit\.json/u,
    );
    assert.deepEqual(await readdir(join(root, ".akari", "reports", "render-receipts")), []);
  });
});

test("caption font mutation after planning prevents receipt creation", async () => {
  await withProject(async (root) => {
    const { asset } = await fakeCaptionFontRepository(root);
    const options = await prepareReceiptOptions(root, { captionFontAsset: asset });
    await writeFile(asset.lexical_path, "font-v2", "utf8");
    await assert.rejects(createImmutableRenderReceipt(options), /render inputs changed during rendering: caption-font/u);
    assert.deepEqual(await readdir(join(root, ".akari", "reports", "render-receipts")), []);
  });
});

test("retargeting a project input parent symlink cannot bind the receipt to the old source", async () => {
  await withProject(async (root) => {
    const edit = {
      version: 0,
      output: { width: 1920, height: 1080, fps: 30 },
      source: { path: "assets/source.mp4", proxy: null },
      cuts: [{ in: 0, out: 1 }],
      overlays: [],
    };
    await file(root, "real-a/source.mp4", "source-a");
    await file(root, "real-b/source.mp4", "source-b");
    await symlink("real-a", join(root, "assets"));
    const editText = `${JSON.stringify(edit, null, 2)}\n`;
    await file(root, "edit.json", editText);
    const currentEditText = await readFile(join(root, "edit.json"), "utf8");
    const currentEdit = readRenderEdit(currentEditText, join(root, ".akari", "render-tmp")).edit;
    const declaredInputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit: currentEdit, editText: currentEditText });
    const sourceInput = declaredInputs.find((input) => input.role === "source:main");
    assert.equal(sourceInput.path, "assets/source.mp4");
    assert.match(sourceInput.absolute_path, /\/real-a\/source\.mp4$/u);
    const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
    await file(root, ".akari/lint.json", '{"version":1,"inputs":{},"verdict":"pass"}\n');
    await file(root, "review.json", '{"version":0,"annotations":[]}\n');
    const outputPath = await file(root, "exports/final.mp4", "rendered-from-source-b");

    await rm(join(root, "assets"));
    await symlink("real-b", join(root, "assets"));
    await assert.rejects(createImmutableRenderReceipt({
      projectRoot: root,
      declaredInputs,
      inputSnapshot,
      outputPath,
      ffprobe: { duration_seconds: 1 },
      plan: { output: "exports/final.mp4", commands: {} },
      verify: { verdict: "pass" },
      tools: { fixture: "1" },
      createdAt: "2026-08-03T00:00:00.000Z",
    }), /lexical input binding changed during rendering/u);
    assert.deepEqual(await readdir(join(root, ".akari", "reports", "render-receipts")), []);
  });
});

test("receipt directories cannot be symlinked outside the project", async (t) => {
  for (const target of ["reports", "render-receipts"]) {
    await t.test(target, async () => {
      const external = await mkdtemp(join(tmpdir(), "akari-external-receipts-"));
      try {
        await withProject(async (root) => {
          const options = await prepareReceiptOptions(root);
          if (target === "reports") {
            await symlink(external, join(root, ".akari", "reports"));
          } else {
            await mkdir(join(root, ".akari", "reports"));
            await symlink(external, join(root, ".akari", "reports", "render-receipts"));
          }
          await assert.rejects(
            createImmutableRenderReceipt(options),
            /not a regular contained project directory/u,
          );
          assert.deepEqual(await readdir(external), []);
        });
      } finally {
        await rm(external, { recursive: true, force: true });
      }
    });
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
