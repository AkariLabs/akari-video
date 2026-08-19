import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "../../../render-cut/src/render-inputs.mjs";
import { resolveCanonicalCaptionFontAsset } from "../../../render-cut/src/caption-font.mjs";
import { createImmutableRenderReceipt } from "../../../render-cut/src/render-receipt.mjs";
import { readRenderEdit } from "../../../render-cut/src/internal-render.mjs";
import migrate from "../../../edit-store/lib/migrate/index.js";

const { migrateEditToV2 } = migrate;

export async function createIntegrityFixture(root, {
  reviewStatus = "resolved",
  usePresetLut = false,
  audioQc = null,
  fullRoleInputs = false,
} = {}) {
  await mkdir(join(root, ".akari"), { recursive: true });
  await mkdir(join(root, "assets", "analysis", "source"), { recursive: true });
  await mkdir(join(root, "exports"), { recursive: true });
  if (fullRoleInputs) {
    await mkdir(join(root, "audio"), { recursive: true });
    await mkdir(join(root, "looks"), { recursive: true });
    await mkdir(join(root, "overlays"), { recursive: true });
  }
  await writeJson(join(root, ".akari", "connections.json"), { version: 1 });
  await writeJson(join(root, ".akari", "workflow.json"), { version: 1, roles: [], events: {} });
  await writeJson(join(root, ".akari", "intake.json"), { version: 1, status: "submitted" });
  await writeFile(join(root, "assets", "source.mp4"), "fixture-source\n", "utf8");
  await writeJson(join(root, "assets", "analysis", "source", "analysis.json"), {
    version: 0,
    source: "../../source.mp4",
  });
  await writeJson(join(root, "plan.json"), { version: 0, slots: [] });
  if (fullRoleInputs) {
    await writeJson(join(root, "captions.json"), {
      version: 1,
      captions: [{ id: "caption-1", src: "source-1", start: 0, end: 1, text: "fixture caption" }],
    });
    await writeFile(join(root, "audio", "narration.wav"), "fixture narration\n", "utf8");
    await writeFile(join(root, "audio", "bgm.wav"), "fixture bgm\n", "utf8");
    await writeFile(join(root, "audio", "sfx.wav"), "fixture sfx\n", "utf8");
    await writeFile(join(root, "looks", "custom.cube"), "TITLE fixture\nLUT_3D_SIZE 2\n", "utf8");
    await writeFile(join(root, "overlays", "caption.html"), "<div>fixture overlay</div>\n", "utf8");
  }
  const legacyEdit = {
    version: 1,
    sources: [{ id: "source-1", path: "assets/source.mp4", proxy: null }],
    cuts: [{ src: "source-1", in: 0, out: 1 }],
    overlays: fullRoleInputs
      ? [{ id: "overlay-1", html: "overlays/caption.html", start: 0, duration: 1 }]
      : [],
    ...((audioQc || fullRoleInputs) ? { audio: {
      ...(audioQc ? { master: { loudnorm: -14, true_peak_dbtp: -1.7 } } : {}),
      ...(fullRoleInputs ? {
        narration: [{ id: "narration-1", path: "audio/narration.wav", start: 0 }],
        bgm: { path: "audio/bgm.wav" },
        sfx: [{ path: "audio/sfx.wav", start: 0 }],
      } : {}),
    } } : {}),
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      path: "exports/final.mp4",
      ...(fullRoleInputs
        ? { look: { lut: "looks/custom.cube", intensity: 1 } }
        : usePresetLut ? { look: { lut: "natural", intensity: 1 } } : {}),
    },
  };
  const migrated = migrateEditToV2(legacyEdit);
  if (!migrated.ok) throw new Error(migrated.blockers.join(" / "));
  await writeJson(join(root, "edit.json"), migrated.doc);
  const edit = readRenderEdit(migrated.doc, join(root, ".akari", "render-tmp")).edit;
  await writeJson(join(root, "review.json"), {
    version: 0,
    annotations: [{
      id: "review-1",
      createdAt: "2026-08-03T00:00:00.000Z",
      sourceT: 0,
      text: "fixture review",
      input: "session",
      status: reviewStatus,
      response: reviewStatus === "open" ? null : {
        summary: "fixture response",
        action: "edited",
        respondedAt: "2026-08-03T00:00:00.500Z",
      },
    }],
  });
  const editText = await readFile(join(root, "edit.json"), "utf8");
  const reviewText = await readFile(join(root, "review.json"), "utf8");
  await writeJson(join(root, ".akari", "lint.json"), {
    version: 1,
    verdict: "pass",
    inputs: {
      edit_json_sha256: sha256(editText),
      review_json_sha256: sha256(reviewText),
    },
  });
  await writeFile(join(root, "exports", "final.mp4"), "fixture-output\n", "utf8");
  const plan = { renderer: "integrity-fixture", output: "exports/final.mp4" };
  const verify = { verdict: "pass" };
  const declaredInputs = await enumerateDeclaredRenderInputs({
    projectRoot: root,
    edit,
    editText,
    captionFontAsset: fullRoleInputs ? resolveCanonicalCaptionFontAsset() : null,
  });
  const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
  const receipt = await createImmutableRenderReceipt({
    projectRoot: root,
    declaredInputs,
    inputSnapshot,
    outputPath: join(root, "exports", "final.mp4"),
    ffprobe: { duration: 1 },
    plan,
    verify,
    tools: { fixture: "1" },
    audioQc,
    createdAt: "2026-08-03T00:00:00.000Z",
  });
  await writeJson(join(root, ".akari", "render.json"), {
    version: 1,
    phase: "verified",
    plan,
    verify,
    ...(audioQc ? { audio_qc: audioQc } : {}),
    render_receipt: { path: receipt.path, sha256: receipt.sha256 },
  });
  return { edit, plan, receipt, declaredInputs, inputSnapshot };
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
