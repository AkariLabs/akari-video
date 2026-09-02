import fs from "node:fs";
import path from "node:path";

import {
  parseEdit,
  projectLegacyAudioView,
  readInternalEdit,
  setSfxGainDbInSource,
  updateArrayElementByIndex,
  updateBgmInSource,
} from "../../edit-store/lib/index.js";
import { openProject } from "../../edit-store/lib/project.js";
import { lintProject } from "../../edit-lint/src/edit-lint.mjs";
import { measureAudioLevels } from "../../media-bin/src/audio-measure.mjs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import {
  DEFAULT_LEVEL_TARGETS,
  DEFAULT_TRUE_PEAK_CEILING_DBTP,
  computeInsertLevel,
  roleForClip,
} from "../../audio-library-setup/shared/insert-level.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function has(value, key) {
  return isRecord(value) && Object.hasOwn(value, key);
}

function resolveTargets(targets) {
  if (targets === undefined) return DEFAULT_LEVEL_TARGETS;
  if (!isRecord(targets)) throw new Error("--targets は JSON object で指定してください");
  const result = { ...DEFAULT_LEVEL_TARGETS };
  for (const [role, value] of Object.entries(targets)) {
    if (!Number.isFinite(value)) throw new Error(`--targets の ${role} は有限数で指定してください`);
    result[role] = value;
  }
  return result;
}

function collectV2(raw) {
  const internal = readInternalEdit(raw);
  const view = projectLegacyAudioView(internal);
  const itemIds = new Map();
  for (const track of internal.tracks) {
    for (const item of track.items) {
      if (["sfx", "narration", "bgm"].includes(item.legacy.collection)) {
        itemIds.set(`${item.legacy.collection}:${item.legacy.index}`, item.id);
      }
    }
  }
  const rawItemsById = new Map();
  for (const track of Array.isArray(raw.tracks) ? raw.tracks : []) {
    for (const item of isRecord(track) && Array.isArray(track.items) ? track.items : []) {
      if (isRecord(item) && typeof item.id === "string") rawItemsById.set(item.id, item);
    }
  }
  const clips = [];
  function add(collection, declaration, index) {
    if (!isRecord(declaration) || typeof declaration.path !== "string") return;
    const itemId = itemIds.get(`${collection}:${index}`);
    const item = rawItemsById.get(itemId);
    if (!item || has(item, "gain_db")) return;
    clips.push({
      version: 2,
      itemId,
      declaredPath: declaration.path,
      collection,
      raw: item,
    });
  }
  view.sfx.forEach((item, index) => add("sfx", item, index));
  view.narration.forEach((item, index) => add("narration", item, index));
  if (view.bgm) add("bgm", view.bgm, 0);
  return clips;
}

function collectLegacy(source, raw) {
  const view = parseEdit(source);
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const clips = [];
  const rawSfx = Array.isArray(audio.sfx) ? audio.sfx : [];
  view.audioSfx.forEach((item, index) => {
    if (!has(rawSfx[index], "gain_db")) clips.push({
      version: 1, collection: "sfx", index, declaredPath: item.path, raw: rawSfx[index] ?? {},
    });
  });
  const rawNarration = Array.isArray(audio.narration) ? audio.narration : [];
  view.audioNarration.forEach((item, index) => {
    if (!has(rawNarration[index], "gain_db")) clips.push({
      version: 1, collection: "narration", index, declaredPath: item.path, raw: rawNarration[index] ?? {},
    });
  });
  if (view.audioBgm && !has(audio.bgm, "gain_db")) clips.push({
    version: 1, collection: "bgm", index: 0, declaredPath: view.audioBgm.path, raw: audio.bgm ?? {},
  });
  return clips;
}

function addFieldsToLegacyArray(source, key, index, fields) {
  return updateArrayElementByIndex(source, key, index, key === "narration" ? "ナレーション" : "SE", (element) => {
    const value = JSON.parse(element);
    return JSON.stringify({ ...value, ...fields });
  });
}

function legacyFadeSpecified(raw, snake, camel) {
  return has(raw, snake) || has(raw, camel);
}

function writeLegacy(source, rows) {
  let next = source;
  for (const row of rows) {
    const fadeFields = {
      ...(!legacyFadeSpecified(row.clip.raw, "fade_in", "fadeIn") ? { fade_in: row.fade_in } : {}),
      ...(!legacyFadeSpecified(row.clip.raw, "fade_out", "fadeOut") ? { fade_out: row.fade_out } : {}),
    };
    if (row.clip.collection === "sfx") {
      next = setSfxGainDbInSource(next, row.clip.index, row.gain_db);
      if (Object.keys(fadeFields).length > 0) next = addFieldsToLegacyArray(next, "sfx", row.clip.index, fadeFields);
    } else if (row.clip.collection === "narration") {
      next = addFieldsToLegacyArray(next, "narration", row.clip.index, { gain_db: row.gain_db, ...fadeFields });
    } else {
      next = updateBgmInSource(next, {
        gainDb: row.gain_db,
        ...(!legacyFadeSpecified(row.clip.raw, "fade_in", "fadeIn") ? { fadeIn: row.fade_in } : {}),
        ...(!legacyFadeSpecified(row.clip.raw, "fade_out", "fadeOut") ? { fadeOut: row.fade_out } : {}),
      });
    }
  }
  return next;
}

async function assertLintPass(projectRoot, lintRunner) {
  const result = await lintRunner(projectRoot, { writeReports: false });
  const errors = Array.isArray(result?.findings)
    ? result.findings.filter((finding) => finding?.severity === "error") : [];
  if (errors.length > 0 || result?.verdict === "fail") {
    throw new Error(errors[0]?.message ?? "edit-lint が変更を拒否しました");
  }
}

async function writeRows({ projectRoot, editPath, originalText, version, rows, lintRunner, openProjectRunner }) {
  try {
    if (version === 2) {
      const project = await openProjectRunner(projectRoot);
      for (const row of rows) {
        const patch = {
          gain_db: row.gain_db,
          ...(!has(row.clip.raw, "fade_in") ? { fade_in: row.fade_in } : {}),
          ...(!has(row.clip.raw, "fade_out") ? { fade_out: row.fade_out } : {}),
        };
        project.edit.update(row.clip.itemId, patch);
      }
      await project.save({ lint: false });
    } else {
      fs.writeFileSync(editPath, writeLegacy(originalText, rows), "utf8");
    }
    await assertLintPass(projectRoot, lintRunner);
  } catch (error) {
    fs.writeFileSync(editPath, originalText, "utf8");
    throw new Error(`edit-lint error のため edit.json を元に戻しました: ${error instanceof Error ? error.message : String(error)}`.replace(/\s+/gu, " "));
  }
}

export async function audioLevelProject(projectDir, options = {}) {
  const projectRoot = path.resolve(projectDir);
  const editPath = path.join(projectRoot, "edit.json");
  const originalText = fs.readFileSync(editPath, "utf8");
  const raw = JSON.parse(originalText);
  const version = raw.version === 2 ? 2 : 1;
  const clips = version === 2 ? collectV2(raw) : collectLegacy(originalText, raw);
  const warnings = [];
  const rows = [];
  const targets = resolveTargets(options.targets);
  const ceilingDbtp = options.ceilingDbtp ?? DEFAULT_TRUE_PEAK_CEILING_DBTP;
  if (!Number.isFinite(ceilingDbtp)) throw new Error("--ceiling は有限数で指定してください");
  const ffmpegPath = options.ffmpegPath ?? resolveFfmpeg();
  const measureRunner = options.measureRunner ?? measureAudioLevels;
  const cacheDir = path.join(projectRoot, ".akari", "cache", "audio-measure");

  for (const clip of clips) {
    const materialPath = path.isAbsolute(clip.declaredPath)
      ? clip.declaredPath : path.resolve(path.dirname(editPath), clip.declaredPath);
    if (!fs.existsSync(materialPath)) {
      warnings.push(`warning: 素材が見つからないため省略します: ${clip.declaredPath}`);
      continue;
    }
    try {
      const measured = await measureRunner({
        ffmpegPath, filePath: materialPath, cacheDir, useCache: options.useCache !== false,
      });
      const role = roleForClip({
        role: clip.explicitRole,
        collection: clip.collection,
        path: clip.declaredPath,
        durationSec: measured.duration_sec,
      });
      const proposal = computeInsertLevel({ role, measured, targets, ceilingDbtp });
      rows.push({
        path: clip.declaredPath,
        role,
        basis: proposal.basis,
        integrated_lufs: measured.integrated_lufs,
        true_peak_dbtp: measured.true_peak_dbtp,
        gain_db: proposal.gain_db,
        fade_in: proposal.fade_in,
        fade_out: proposal.fade_out,
        written: false,
        clip,
      });
    } catch (error) {
      warnings.push(`warning: 計測できないため省略します: ${clip.declaredPath} (${error instanceof Error ? error.message : String(error)})`.replace(/\s+/gu, " "));
    }
  }

  if (options.write && rows.length > 0) {
    await writeRows({
      projectRoot,
      editPath,
      originalText,
      version,
      rows,
      lintRunner: options.lintRunner ?? lintProject,
      openProjectRunner: options.openProjectRunner ?? openProject,
    });
    for (const row of rows) row.written = true;
  }

  return { rows: rows.map(({ clip, ...row }) => row), warnings, targetCount: rows.length };
}

function displayNumber(value) {
  return Number.isFinite(value) ? String(value) : "-";
}

export function formatAudioLevelTable(result) {
  if (result.targetCount === 0) return ["対象 0 件"];
  const lines = ["path\trole\tbasis\tI(LUFS)\tTP(dBTP)\tgain_db\tfade_in\tfade_out\tstatus"];
  for (const row of result.rows) lines.push([
    row.path,
    row.role,
    row.basis,
    displayNumber(row.integrated_lufs),
    displayNumber(row.true_peak_dbtp),
    displayNumber(row.gain_db),
    displayNumber(row.fade_in),
    displayNumber(row.fade_out),
    row.written ? "書込済み" : "-",
  ].join("\t"));
  return lines;
}
