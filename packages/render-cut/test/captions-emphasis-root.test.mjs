import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";
import { loadCaptions } from "../src/render-cut.mjs";

const CAPTIONS = [{
  id: "c-0001",
  start: 0,
  end: 2,
  text: "最高です",
  speaker: null,
  sourceRef: null,
  edited: false,
  style: "karaoke",
  words: [
    { start: 0, end: 1, text: "最高" },
    { start: 1, end: 2, text: "です" },
  ],
}];
const CUTS = [{ in: 0, out: 2 }];
const EDIT = {
  version: 1,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  cuts: CUTS,
};

function emphasis(overrides = {}) {
  return {
    id: "e-0001",
    t_start: 0,
    t_end: 1,
    word: "最高",
    emotion: "joy",
    style_hint: "size-pulse",
    ...overrides,
  };
}

async function withCaptionsRoot(root, callback) {
  const project = await mkdtemp(join(tmpdir(), "render-cut-captions-emphasis-root-"));
  try {
    await writeFile(join(project, "captions.json"), `${JSON.stringify(root, null, 2)}\n`, "utf8");
    return await callback(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

test("captions.json emphasis_words produces the same emphasis CSS as the legacy edit.json seat", async () => {
  const words = [emphasis()];
  await withCaptionsRoot({ captions: CAPTIONS, emphasis_words: words }, async (project) => {
    const loaded = await loadCaptions(project, EDIT);
    const legacy = generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: words });

    assert.deepEqual(loaded.overlays, legacy);
    assert.equal(loaded.warnings.length, 0);
    assert.match(loaded.overlays[0].html, /data-emphasis-id="e-0001"/u);
    assert.match(loaded.overlays[0].html, /@keyframes akari-emphasis-size-pulse/u);
  });
});

test("captions.json emphasis_words wins when both captions.json and edit.json seats exist", async () => {
  const captionsWord = emphasis({ id: "e-0002", style_hint: "size-pulse" });
  const editWord = emphasis({ id: "e-9000", emotion: "sadness", style_hint: "color-accent" });

  await withCaptionsRoot({ captions: CAPTIONS, emphasis_words: [captionsWord] }, async (project) => {
    const loaded = await loadCaptions(project, { ...EDIT, emphasis_words: [editWord] });
    const html = loaded.overlays[0].html;

    assert.match(html, /data-emphasis-id="e-0002"/u);
    assert.match(html, /@keyframes akari-emphasis-size-pulse/u);
    assert.doesNotMatch(html, /e-9000|akari-caption__tok--color-accent/u);
    assert.equal(loaded.warnings.length, 0);
  });
});

test("legacy edit.json emphasis_words remains the fallback when captions.json omits the seat", async () => {
  const editWord = emphasis({ id: "e-0003", emotion: "sadness", style_hint: "color-accent" });

  await withCaptionsRoot({ captions: CAPTIONS }, async (project) => {
    const loaded = await loadCaptions(project, { ...EDIT, emphasis_words: [editWord] });
    const html = loaded.overlays[0].html;

    assert.match(html, /data-emphasis-id="e-0003"/u);
    assert.match(html, /akari-caption__tok--color-accent/u);
  });
});

test("loadCaptions は単語帳保護で不能な分割だけ fallback して警告する", async () => {
  const root = {
    display_policy: {
      mode: "single_line_sequential", algorithm: "a4-ja-two-fragment-v1",
      unit_metric: "ascii-half-other-one-v1", max_line_units: 3,
      minimum_fragment_duration_seconds: 0.1, locale: "en",
    },
    captions: [{ ...CAPTIONS[0], text: "alpha beta", style: undefined, words: undefined }],
  };
  await withCaptionsRoot(root, async (project) => {
    const memory = join(project, ".akari", "memory");
    await mkdir(memory, { recursive: true });
    await writeFile(join(memory, "word-book.json"), JSON.stringify({
      version: 0,
      entries: [{ surface: "alpha beta", variants: [], kind: "term", protect_break: true }],
    }));
    const errors = [];
    const original = console.error;
    console.error = line => errors.push(line);
    try {
      const loaded = await loadCaptions(project, EDIT);
      assert.deepEqual(loaded.layout.display_cues.map(cue => cue.text), ["alpha", " beta"]);
      assert.deepEqual(loaded.layout.word_book_fallbacks, [{ caption_id: "c-0001", dropped_terms: ["alpha beta"] }]);
      assert.deepEqual(errors, ["単語帳: 1 行で行分割保護を外しました"]);
    } finally {
      console.error = original;
    }
  });
});
