import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import {
  BUNDLED_CAPTION_FONT_FAMILIES,
  availableCaptionFontFamilies,
  captionFontFamilies,
} from "../src/lint/caption-fonts.mjs";
import { captionFontFamilies as renderCutCaptionFontFamilies } from "../../render-cut/src/caption-font-faces.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "../..");
const bundledFacesPath = join(repositoryRoot, "packages/render-cut/src/caption-font-faces.json");

function baseEdit() {
  return {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: "main", path: "main.mp4" }],
    tracks: [
      {
        id: "v-main",
        lane: "visual",
        items: [
          { id: "cut-1", at: 0, duration: 180, source: { kind: "media", src: "main", in: 0, out: 6 } },
        ],
      },
      {
        id: "v-captions",
        lane: "visual",
        items: [
          {
            id: "captions",
            name: "字幕",
            at: 0,
            duration: 180,
            source: { kind: "captions", path: "captions.json" },
            items: [],
          },
        ],
      },
    ],
  };
}

async function makeProject(captions) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-caption-fonts-"));
  await mkdir(join(root, ".akari"), { recursive: true });
  await writeFile(join(root, "main.mp4"), "fixture", "utf8");
  await writeFile(join(root, "edit.json"), `${JSON.stringify(baseEdit(), null, 2)}\n`, "utf8");
  await writeFile(join(root, "captions.json"), `${JSON.stringify(captions, null, 2)}\n`, "utf8");
  return root;
}

function captionCue(overrides = {}) {
  return {
    id: "c-0001",
    start: 1,
    end: 2,
    text: "字幕",
    speaker: null,
    sourceRef: null,
    edited: false,
    ...overrides,
  };
}

async function lintCaptions(captions) {
  const project = await makeProject(captions);
  try {
    return await lintProject(project, { checkedAt: "2000-01-01T00:00:00.000Z", writeReports: false });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function fontFindings(result) {
  return result.findings.filter((finding) => finding.check === "captions.font-unavailable");
}

test("an unavailable default and per-cue font_family warn with usable alternatives", async () => {
  const result = await lintCaptions({
    default_text_style: { font_family: "Hiragino Sans", color: "#FFFFFF" },
    captions: [captionCue({ text_style: { font_family: "Yu Gothic" } })],
  });
  const findings = fontFindings(result);
  assert.equal(findings.length, 2);
  assert.equal(result.verdict, "pass");
  const byPath = new Map(findings.map((finding) => [finding.path, finding]));
  const defaultValue = byPath.get("captions.json#default_text_style");
  const cueValue = byPath.get("captions.json#[0].text_style");
  assert.equal(defaultValue?.severity, "warning");
  assert.match(defaultValue?.message ?? "", /"Hiragino Sans"/u);
  assert.match(cueValue?.message ?? "", /"Yu Gothic"/u);
  for (const finding of findings) {
    assert.match(finding.message, /use one of /u);
    const alternatives = [...finding.message.matchAll(/"([^"]+)"/gu)].slice(1).map((match) => match[1]);
    assert.ok(alternatives.length >= 1 && alternatives.length <= 3, finding.message);
    assert.ok(alternatives.includes("Noto Sans JP"), finding.message);
  }
});

test("bundled fonts and product aliases do not warn", async () => {
  const result = await lintCaptions({
    default_text_style: { font_family: '"AKARI Noto Sans JP", "Noto Sans JP", sans-serif', color: "#FFFFFF" },
    captions: [captionCue({ text_style: { font_family: "BIZ UDGothic" } })],
  });
  assert.deepEqual(fontFindings(result), []);
});

test("only the named family that the exporter cannot embed warns", async () => {
  const result = await lintCaptions({
    default_text_style: { font_family: '"Hiragino Sans", "Noto Sans JP", sans-serif' },
    captions: [captionCue()],
  });
  const findings = fontFindings(result);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /"Hiragino Sans"/u);
  assert.doesNotMatch(findings[0].message, /"Noto Sans JP" is not available/u);
});

test("an array-root captions.json checks per-cue text_style", async () => {
  const result = await lintCaptions([
    captionCue({ text_style: { font_family: "Hiragino Sans" } }),
    captionCue({ id: "c-0002", text_style: { font_family: "Noto Sans JP" } }),
  ]);
  const findings = fontFindings(result);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "captions.json#[0].text_style");
});

test("a font installed in the font library is available for export", async () => {
  const home = await mkdtemp(join(tmpdir(), "edit-lint-font-library-"));
  const libraryRoot = join(home, "library");
  const fontDir = join(libraryRoot, "font", "probe-sans");
  const previousHome = process.env.AKARI_HOME;
  const previousLibraryRoot = process.env.AKARI_LIBRARY_ROOT;
  try {
    await mkdir(fontDir, { recursive: true });
    await copyFile(
      join(repositoryRoot, "assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"),
      join(fontDir, "ProbeSans.ttf"),
    );
    await writeFile(join(fontDir, "meta.json"), `${JSON.stringify({
      id: "probe-sans",
      category: "font",
      title: "Probe Sans",
      tags: [],
      license: {},
    }, null, 2)}\n`, "utf8");
    const available = availableCaptionFontFamilies({ AKARI_HOME: home, AKARI_LIBRARY_ROOT: libraryRoot });
    assert.ok(available.has("Probe Sans"));

    process.env.AKARI_HOME = home;
    process.env.AKARI_LIBRARY_ROOT = libraryRoot;
    const result = await lintCaptions({
      default_text_style: { font_family: "Probe Sans" },
      captions: [captionCue()],
    });
    assert.deepEqual(fontFindings(result), []);
  } finally {
    if (previousHome === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = previousHome;
    if (previousLibraryRoot === undefined) delete process.env.AKARI_LIBRARY_ROOT;
    else process.env.AKARI_LIBRARY_ROOT = previousLibraryRoot;
    await rm(home, { recursive: true, force: true });
  }
});

test("the bundled font list and family parser stay in parity with render-cut", async () => {
  const faces = JSON.parse(await readFile(bundledFacesPath, "utf8"));
  assert.deepEqual(
    [...BUNDLED_CAPTION_FONT_FAMILIES].sort(),
    [...new Set(faces.map((face) => face.family))].sort(),
  );
  const samples = [
    "Hiragino Sans",
    '"Hiragino Sans", "Noto Sans JP", sans-serif',
    "'M PLUS Rounded 1c', 'BIZ UDGothic'",
    "Noto Sans JP, ui-serif, system-ui",
    "",
    '"unterminated',
    "Klee\\ One",
  ];
  for (const sample of samples) {
    assert.deepEqual(captionFontFamilies(sample), renderCutCaptionFontFamilies(sample), sample);
  }
});
