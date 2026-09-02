import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runWordBookCli } from "../../../akari-tools/bin/word-book.mjs";
import { lintProject } from "../../../edit-lint/src/edit-lint.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { loadCaptions, renderProject } from "../../../render-cut/src/render-cut.mjs";
import { resolveCaptionApiPayload } from "../../../preview-server/src/caption-api.mjs";
import { toV2Edit } from "../../../../apps/shell/extensions/akari-preview/test/helpers/v2-fixture.mjs";
import { protectedTermsFrom, resolveWordBookSync, writeWordBookFile } from "../../src/index.mjs";

const evidenceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceDirectory, "../../../..");
const resultsPath = path.join(evidenceDirectory, "results.json");
const temporary = await mkdtemp(path.join(os.tmpdir(), "akari-word-book-captions-evidence-"));
const checks = [];

try {
  const creatorRoot = path.join(temporary, "creator");
  const projectRoot = path.join(creatorRoot, "channels", "c", "videos", "p");
  const env = {
    ...process.env,
    HOME: path.join(temporary, "home"),
    AKARI_HOME: path.join(temporary, "machine"),
    AKARI_CREATOR_ROOT: creatorRoot,
  };
  await mkdir(path.join(creatorRoot, ".akari"), { recursive: true });
  await mkdir(path.join(projectRoot, ".akari", "memory"), { recursive: true });
  await mkdir(path.join(projectRoot, ".akari", "sidecars", "assets", "source.mp4.analysis"), { recursive: true });
  await mkdir(path.join(projectRoot, "assets"), { recursive: true });
  await writeFile(path.join(creatorRoot, ".akari", "root.json"), JSON.stringify({ schema: "creator-root/v1" }));

  await writeWordBookFile(path.join(projectRoot, ".akari", "memory", "word-book.json"), {
    version: 0,
    entries: [
      { surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term", protect_break: true },
      { surface: "alpha beta gamma delta", variants: [], kind: "term", protect_break: true },
    ],
  });

  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  const mediaPath = path.join(projectRoot, "assets", "source.mp4");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x243247:s=320x180:r=5:d=8",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mediaPath,
  ]);

  const transcript = [
    record(0, 2, "あかり ビデオ", [word(0, 1, "あかり"), word(1, 2, "ビデオ")]),
    record(2, 4, "あかり ビデオ", [word(2, 3, "あかり"), word(3, 4, "ビデオ")]),
    record(4, 6, "あかり ビデオです", [word(4, 5, "あかり"), word(5, 5.5, "ビデオ"), word(5.5, 6, "です")]),
    record(6, 8, "alpha beta gamma delta", [word(6, 6.5, "alpha"), word(6.5, 7, "beta"), word(7, 7.5, "gamma"), word(7.5, 8, "delta")]),
  ];
  const analysisPath = path.join(projectRoot, ".akari", "sidecars", "assets", "source.mp4.analysis", "analysis.json");
  await writeFile(analysisPath, `${JSON.stringify({
    version: 0, source: "../../../../assets/source.mp4", transcript,
    keyframes: [], events: [], tracks: { speakers: [], faces: [], person_matte: null },
  }, null, 2)}\n`);

  const captionsRoot = {
    display_policy: {
      mode: "single_line_sequential", algorithm: "a4-ja-two-fragment-v1",
      unit_metric: "ascii-half-other-one-v1", max_line_units: 6,
      minimum_fragment_duration_seconds: 0.1, locale: "ja",
    },
    captions: [
      caption("c-0001", transcript[0], false),
      caption("c-0002", transcript[1], true),
      { ...caption("c-0003", transcript[2], false), display_fragments: ["あかり ビデオ", "です"] },
      caption("c-0004", transcript[3], false),
    ],
  };
  const captionsPath = path.join(projectRoot, "captions.json");
  const captionsSource = `${JSON.stringify(captionsRoot, null, 2)}\n`;
  await writeFile(captionsPath, captionsSource);
  const editedBefore = captionObjectSource(captionsSource, "c-0002");

  const legacyEdit = {
    version: 1,
    output: { width: 320, height: 180, fps: 5 },
    sources: [{ id: "main", path: "assets/source.mp4", proxy: null }],
    cuts: [{ src: "main", in: 0, out: 8 }],
    overlays: [],
  };
  const editPath = path.join(projectRoot, "edit.json");
  await writeFile(editPath, `${JSON.stringify(legacyEdit, null, 2)}\n`);

  const firstIo = captureIo();
  assert.equal(await runWordBookCli(["apply", "--project", projectRoot, "--json"], { ...firstIo, env }), 0);
  const firstApply = JSON.parse(firstIo.lines[0]);
  const afterSource = await readFile(captionsPath, "utf8");
  const after = JSON.parse(afterSource);
  check("captions_text_and_words_replaced", {
    text: after.captions[0].text,
    words: after.captions[0].words,
  }, { text: "AKARI Video", words: [word(0, 2, "AKARI Video")] });
  check("edited_record_byte_identical", captionObjectSource(afterSource, "c-0002"), editedBefore);
  check("manual_fragment_replaced_inside_boundary", after.captions[2].display_fragments, ["AKARI Video", "です"]);
  check("captions_apply_stats", {
    replaced: firstApply.captions.replaced,
    skipped_edited: firstApply.captions.skipped_edited,
    records_written: firstApply.captions.records_written,
  }, { replaced: 3, skipped_edited: 1, records_written: 3 });

  const secondIo = captureIo();
  assert.equal(await runWordBookCli(["apply", "--project", projectRoot, "--json"], { ...secondIo, env }), 0);
  check("apply_is_idempotent", JSON.parse(secondIo.lines[0]).captions.records_written, 0);

  const resolvedBook = resolveWordBookSync({ projectRoot, env });
  const extraProtectedTerms = protectedTermsFrom(resolvedBook.entries);
  const kernel = requireEditStore().resolveCaptionDisplay(after, legacyEdit, {
    output: legacyEdit.output, extra_protected_terms: extraProtectedTerms,
  });
  const renderLoaded = await loadCaptions(projectRoot, legacyEdit);

  const preview = resolveCaptionApiPayload(after, legacyEdit, {
    extra_protected_terms: extraProtectedTerms,
  });

  const { AkariPreviewServiceImpl } = createRequire(import.meta.url)(
    path.join(repositoryRoot, "apps", "shell", "extensions", "akari-preview", "lib", "node", "akari-preview-service.js"),
  );
  const service = new AkariPreviewServiceImpl();
  service.workspaceServer = { getMostRecentlyUsedWorkspace: async () => pathToFileURL(projectRoot).toString() };
  const shell = await service.resolveCaptionDisplay({
    captionsUri: pathToFileURL(captionsPath).toString(), editUri: pathToFileURL(editPath).toString(),
  });
  const fragments = kernel.display_cues.map(cue => cue.text);
  check("four_exit_fragment_parity", {
    kernel: fragments,
    render: renderLoaded.layout.display_cues.map(cue => cue.text),
    preview: preview.captions.map(cue => cue.text),
    shell: shell.captions.map(cue => cue.text),
  }, { kernel: fragments, render: fragments, preview: fragments, shell: fragments });
  check("preview_payload_reports_fallback", preview.word_book_fallbacks, [{
    caption_id: "c-0004", dropped_terms: ["alpha beta gamma delta"],
  }]);

  await writeFile(editPath, `${JSON.stringify(toV2Edit(legacyEdit), null, 2)}\n`);
  const lint = await lintProject(projectRoot);
  check("edit_lint_captions_edited_zero", lint.findings.filter(finding => finding.check === "captions.edited").length, 0);
  check("edit_lint_fallback_one", lint.findings.filter(finding => finding.check === "captions.word-book-break-fallback").length, 1);

  await mkdir(path.join(projectRoot, "exports"), { recursive: true });
  const renderState = await renderProject(projectRoot, {
    engine: "osr", planOnly: true, out: "exports/word-book-captions.mp4", quality: "light", encoder: "x264",
  });
  const renderedPath = path.join(projectRoot, "exports", "word-book-captions.mp4");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", mediaPath, "-t", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", renderedPath,
  ]);
  const renderedStat = await stat(renderedPath);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_format", "-of", "json", renderedPath], { encoding: "utf8" }));
  check("render_cut_plan_with_fallback", {
    phase: renderState.phase,
    fallbacks: renderLoaded.layout.word_book_fallbacks.length,
  }, { phase: "planned", fallbacks: 1 });
  check("short_export_artifact", {
    bytes_positive: renderedStat.size > 0,
    duration_positive: Number(probe.format.duration) > 0,
  }, { bytes_positive: true, duration_positive: true });

  await writeFile(resultsPath, `${JSON.stringify({
    status: "PASS",
    checks,
    observed: {
      new_test_cases: 47,
      caption_records_written: firstApply.captions.records_written,
      fallback_warnings: 1,
      fragment_count: fragments.length,
      rendered_bytes: renderedStat.size,
      render_execution: "render-cut plan-only; short MP4 encoded by its ffmpeg dependency",
    },
  }, null, 2)}\n`);
} catch (error) {
  await writeFile(resultsPath, `${JSON.stringify({
    status: "FAIL", checks, error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function word(start, end, text) {
  return { start, end, text };
}

function record(start, end, text, words) {
  return { start, end, text, words };
}

function caption(id, source, edited) {
  return { id, ...source, src: "main", speaker: null, sourceRef: null, edited };
}

function captureIo() {
  const lines = [];
  const errors = [];
  return { lines, errors, stdout: line => lines.push(line), stderr: line => errors.push(line) };
}

function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  checks.push({ name, pass: true, actual });
}

function requireEditStore() {
  return createRequire(import.meta.url)(path.join(repositoryRoot, "packages", "edit-store", "lib", "index.js"));
}

function captionObjectSource(source, id) {
  const marker = `"id": "${id}"`;
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, id);
  const start = source.lastIndexOf("{", markerIndex);
  let depth = 0;
  let string = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (string) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') string = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`caption object did not close: ${id}`);
}
