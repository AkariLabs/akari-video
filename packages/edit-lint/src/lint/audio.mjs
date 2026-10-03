import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isInlineOverlayHtml } from "../shape-lane.mjs";
import { musicGrid } from "../../../audio-library-setup/shared/beat-grid.mjs";
import { EPSILON, addFinding, addSkipped, formatNumber, isFiniteNumber, isNonEmptyString, isRecord, isRegularFile, messageOf, relativePath, resolveReference, resolveReferenceBinding, unfetchedLibraryNote } from "./shared.mjs";
import { probeAudioDuration } from "./media-probe.mjs";

export function validateLegacyNarrationTrim(narration, findings) {
  if (!Array.isArray(narration)) return;
  for (const [index, item] of narration.entries()) {
    if (!isRecord(item)) continue;
    const itemPath = `edit.json#audio.narration[${index}]`;
    for (const field of ["in", "out"]) {
      if (!Object.hasOwn(item, field)
        || (isFiniteNumber(item[field]) && item[field] >= 0)) continue;
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.trim",
        message: `${field} must be a non-negative finite number`,
        path: `${itemPath}.${field}`,
      });
    }
    if (isFiniteNumber(item.in)
      && item.in >= 0
      && isFiniteNumber(item.out)
      && item.out >= 0
      && item.out <= item.in) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.trim",
        message: "narration must satisfy in < out when both are present",
        path: itemPath,
        range: { start: item.in, end: item.out },
      });
    }
  }
}

export async function validateNarration(narration, timeline, findings, paths) {
  if (narration === undefined) return;
  if (!Array.isArray(narration)) {
    addFinding(findings, {
      severity: "error",
      check: "audio.narration.structure",
      message: "audio.narration must be an array",
      path: "edit.json#audio.narration",
    });
    return;
  }

  const tCounts = new Map();
  for (const item of narration) {
    if (isRecord(item) && isFiniteNumber(item.t)) {
      tCounts.set(item.t, (tCounts.get(item.t) ?? 0) + 1);
    }
  }

  const ids = new Set();
  for (const [index, item] of narration.entries()) {
    const itemPath = `edit.json#audio.narration[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.structure",
        message: "narration item must be an object",
        path: itemPath,
      });
      continue;
    }

    if (!isNonEmptyString(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.id",
        message: "id must be a non-empty string",
        path: itemPath,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.id",
        message: `duplicate narration id: ${item.id}`,
        path: itemPath,
      });
    } else {
      ids.add(item.id);
    }

    if (!isNonEmptyString(item.path)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.path",
        message: "path must be a non-empty string",
        path: itemPath,
      });
    } else {
      const binding = resolveReferenceBinding(paths.editPath, item.path, paths);
      const filePath = binding.path;
      if (!(await isRegularFile(filePath))) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.file",
          message: `narration path does not resolve to a regular file: ${item.path}${unfetchedLibraryNote(binding)}`,
          path: relativePath(paths.projectRoot, filePath),
        });
      }
    }

    if (!isFiniteNumber(item.t) || item.t < 0) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.t",
        message: "t must be a non-negative finite number",
        path: itemPath,
      });
    } else {
      if (timeline !== null && item.t > timeline + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.timeline",
          message: `t ${formatNumber(item.t)}s exceeds timeline duration ${formatNumber(timeline)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
      if ((tCounts.get(item.t) ?? 0) > 1) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.duplicate-t",
          message: `multiple narration items share the same t: ${formatNumber(item.t)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
    }

    if (
      Object.hasOwn(item, "gain_db") &&
      (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.gain-db",
        message: "gain_db must be a finite number within [-60, 12]",
        path: itemPath,
      });
    }
    validateAudioEnvelopeDeclaration(
      item,
      "narration",
      isFiniteNumber(item.in) && isFiniteNumber(item.out) && item.out > item.in ? item.out - item.in : null,
      findings,
      itemPath,
    );
    validateAudioClipFxDeclaration(item, "narration", findings, itemPath);

  }
}

// docs/contract-2026-07-14-edit-json-v1-audio.md §1/§5: bgm/sfx の構造検証は narration と
// 同じ手書きの流儀。ファイル実在欠落は「装飾・欠落は警告」の劣化規約どおり warning に留める
// （validateReferences の一律 error 経路には audio.bgm/sfx を含めない）。
export async function validateBgmSfx(bgm, sfx, timeline, findings, paths) {
  // docs/contract-2026-07-14-edit-json-v1-audio.md §1 says omission means "no BGM"; real
  // edit.json data (fieldtest/2026-07-14) spells that as an explicit `"bgm": null` rather than
  // omitting the key -- the same tolerant-reader convention already used for source.proxy.
  if (bgm !== undefined && bgm !== null) {
    if (!isRecord(bgm)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.bgm.structure",
        message: "audio.bgm must be an object",
        path: "edit.json#audio.bgm",
      });
    } else {
      if (!isNonEmptyString(bgm.path)) {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.path",
          message: "path must be a non-empty string",
          path: "edit.json#audio.bgm",
        });
      } else {
        const binding = resolveReferenceBinding(paths.editPath, bgm.path, paths);
        const filePath = binding.path;
        if (!(await isRegularFile(filePath))) {
          addFinding(findings, {
            severity: "warning",
            check: "audio.bgm.file",
            message: `bgm path does not resolve to a regular file: ${bgm.path}${unfetchedLibraryNote(binding)}`,
            path: relativePath(paths.projectRoot, filePath),
          });
        }
      }
      if (
        Object.hasOwn(bgm, "gain_db") &&
        (!isFiniteNumber(bgm.gain_db) || bgm.gain_db < -60 || bgm.gain_db > 12)
      ) {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.gain-db",
          message: "gain_db must be a finite number within [-60, 12]",
          path: "edit.json#audio.bgm",
        });
      }
      if (Object.hasOwn(bgm, "ducking") && typeof bgm.ducking !== "boolean") {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.ducking",
          message: "ducking must be a boolean",
          path: "edit.json#audio.bgm",
        });
      }
      validateAudioEnvelopeDeclaration(bgm, "bgm", timeline, findings, "edit.json#audio.bgm");
      validateAudioClipFxDeclaration(bgm, "bgm", findings, "edit.json#audio.bgm");
      // audio.bgm.fadeIn/fadeOut clamp rule: render-cut trims/loops bgm to the full timeline, so
      // fadeIn/fadeOut are each independently clamped there at timeline/2 -- warn here so the same
      // overshoot is visible before rendering.
      for (const field of ["fadeIn", "fadeOut"]) {
        if (!Object.hasOwn(bgm, field)) continue;
        if (!isFiniteNumber(bgm[field]) || bgm[field] < 0) {
          addFinding(findings, {
            severity: "error",
            check: `audio.bgm.${field}`,
            message: `${field} must be a non-negative finite number`,
            path: "edit.json#audio.bgm",
          });
        } else if (timeline !== null && bgm[field] > timeline / 2 + EPSILON) {
          addFinding(findings, {
            severity: "warning",
            check: `audio.bgm.${field}`,
            message: `${field} ${formatNumber(bgm[field])}s exceeds half the timeline duration ${formatNumber(timeline)}s; will be clamped to ${formatNumber(timeline / 2)}s at render time`,
            path: "edit.json#audio.bgm",
          });
        }
      }
    }
  }

  if (sfx === undefined || sfx === null) return;
  if (!Array.isArray(sfx)) {
    addFinding(findings, {
      severity: "error",
      check: "audio.sfx.structure",
      message: "audio.sfx must be an array",
      path: "edit.json#audio.sfx",
    });
    return;
  }
  for (const [index, item] of sfx.entries()) {
    const itemPath = `edit.json#audio.sfx[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.structure",
        message: "sfx item must be an object",
        path: itemPath,
      });
      continue;
    }
    if (!isNonEmptyString(item.path)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.path",
        message: "path must be a non-empty string",
        path: itemPath,
      });
    } else {
      const binding = resolveReferenceBinding(paths.editPath, item.path, paths);
      const filePath = binding.path;
      if (!(await isRegularFile(filePath))) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.file",
          message: `sfx path does not resolve to a regular file: ${item.path}${unfetchedLibraryNote(binding)}`,
          path: relativePath(paths.projectRoot, filePath),
        });
      }
    }
    if (!isFiniteNumber(item.t) || item.t < 0) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.t",
        message: "t must be a non-negative finite number",
        path: itemPath,
      });
    } else if (timeline !== null && item.t > timeline + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "audio.sfx.timeline",
        message: `t ${formatNumber(item.t)}s exceeds timeline duration ${formatNumber(timeline)}s`,
        path: itemPath,
        range: { start: item.t, end: item.t },
      });
    }
    if (
      Object.hasOwn(item, "gain_db") &&
      (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.gain-db",
        message: "gain_db must be a finite number within [-60, 12]",
        path: itemPath,
      });
    }
    validateAudioEnvelopeDeclaration(
      item,
      "sfx",
      isFiniteNumber(item.in) && isFiniteNumber(item.out) && item.out > item.in ? item.out - item.in : null,
      findings,
      itemPath,
    );
    validateAudioClipFxDeclaration(item, "sfx", findings, itemPath);
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: in/out はどちらも省略可（片方のみの
    // 指定は valid）で、型不正（負値・非数値）は schema 側（edit.schema.json + validate-edit.mjs）が
    // 拒否する。edit-lint はスキーマ単体では表せない兄弟値の関係（out > in）だけをここで検証する
    // （cuts[].out > in と同じ分担 — cuts.range 参照）。
    if (
      Object.hasOwn(item, "in") &&
      Object.hasOwn(item, "out") &&
      isFiniteNumber(item.in) &&
      isFiniteNumber(item.out) &&
      item.out <= item.in
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.in-out",
        message: "sfx must satisfy in < out when both are present",
        path: itemPath,
        range: { start: item.in, end: item.out },
      });
    }
    // audio.sfx[].fade_in/fade_out (docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2
    // addendum, audio-clip-fades task): type/sign validation always runs; the "fade total exceeds
    // the clip's effective duration" warning only fires when both in and out are present, because
    // that is the only case edit-lint can compute the effective duration (out - in) from sibling
    // values alone -- it has no ffprobe (contract's own "lint は ffprobe を持たない" rule, already
    // applied to sfx.out real-duration overrun above). When in/out are absent, render-cut/preview
    // still clamp fade_in/fade_out against the material's real duration at their own layer; this
    // just can't be linted ahead of time without probing the file.
    let fadeInValue;
    let fadeOutValue;
    for (const field of ["fade_in", "fade_out"]) {
      if (!Object.hasOwn(item, field)) continue;
      if (!isFiniteNumber(item[field]) || item[field] < 0) {
        addFinding(findings, {
          severity: "error",
          check: `audio.sfx.${field}`,
          message: `${field} must be a non-negative finite number`,
          path: itemPath,
        });
      } else if (field === "fade_in") {
        fadeInValue = item[field];
      } else {
        fadeOutValue = item[field];
      }
    }
    if (
      (fadeInValue !== undefined || fadeOutValue !== undefined) &&
      Object.hasOwn(item, "in") &&
      Object.hasOwn(item, "out") &&
      isFiniteNumber(item.in) &&
      isFiniteNumber(item.out) &&
      item.out > item.in
    ) {
      const effectiveDuration = item.out - item.in;
      const fadeTotal = (fadeInValue ?? 0) + (fadeOutValue ?? 0);
      if (fadeTotal > effectiveDuration + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.fade-total",
          message: `fade_in + fade_out ${formatNumber(fadeTotal)}s exceeds the clip's effective duration ${formatNumber(effectiveDuration)}s (in=${formatNumber(item.in)}s, out=${formatNumber(item.out)}s); each will be clamped to half the effective duration at render time`,
          path: itemPath,
          range: { start: item.in, end: item.out },
        });
      }
    }
  }
}

export function validateAudioDuckKeys(value, findings) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(key => key !== "narration" && key !== "speech")
      || new Set(value).size !== value.length) {
    addFinding(findings, {
      severity: "error",
      check: "audio.duck-keys",
      message: "duck_keys must contain unique narration/speech values",
      path: "edit.json#audio.duck_keys",
    });
  }
}

export function validateAudioClipFxDeclaration(value, role, findings, path, options = {}) {
  if (!isRecord(value)) return;
  const sourcePath = options.sourcePath ?? path;
  if (Object.hasOwn(value, "speed")) {
    if (!isFiniteNumber(value.speed) || value.speed <= 0.25 || value.speed > 4) {
      addFinding(findings, {
        severity: "error", check: `audio.${role}.speed`,
        message: "speed must be a finite number within (0.25, 4]", path: `${sourcePath}.speed`,
      });
    }
    if (role === "narration") {
      addFinding(findings, {
        severity: "warning", check: "audio.narration.speed-ignored",
        message: "narration speed is owned by TTS and will be ignored", path: `${sourcePath}.speed`,
      });
    }
  }
  if (Object.hasOwn(value, "pitch_semitones")) {
    if (!isFiniteNumber(value.pitch_semitones)
        || value.pitch_semitones < -24 || value.pitch_semitones > 24) {
      addFinding(findings, {
        severity: "error", check: `audio.${role}.pitch-semitones`,
        message: "pitch_semitones must be a finite number within [-24, 24]",
        path: `${sourcePath}.pitch_semitones`,
      });
    }
    if (role === "narration") {
      addFinding(findings, {
        severity: "warning", check: "audio.narration.pitch-ignored",
        message: "narration pitch_semitones is owned by TTS and will be ignored",
        path: `${sourcePath}.pitch_semitones`,
      });
    }
  }
  if (Object.hasOwn(value, "formant") && value.formant !== "preserve" && value.formant !== "shift") {
    addFinding(findings, {
      severity: "error", check: `audio.${role}.formant`,
      message: "formant must be preserve or shift", path: `${sourcePath}.formant`,
    });
  }
  if (Object.hasOwn(value, "lowcut_hz")
      && (!isFiniteNumber(value.lowcut_hz) || value.lowcut_hz < 0 || value.lowcut_hz > 400)) {
    addFinding(findings, {
      severity: "error", check: `audio.${role}.lowcut-hz`,
      message: "lowcut_hz must be a finite number within [0, 400]", path: `${path}.lowcut_hz`,
    });
  }
  if (!Object.hasOwn(value, "denoise")) return;
  if (!isRecord(value.denoise)) {
    addFinding(findings, {
      severity: "error", check: `audio.${role}.denoise`,
      message: "denoise must be an object", path: `${path}.denoise`,
    });
    return;
  }
  if (value.denoise.method !== "fft" && value.denoise.method !== "nlm") {
    addFinding(findings, {
      severity: "error", check: `audio.${role}.denoise-method`,
      message: "denoise.method must be fft or nlm", path: `${path}.denoise.method`,
    });
  }
  if (!isFiniteNumber(value.denoise.strength)
      || value.denoise.strength < 0 || value.denoise.strength > 1) {
    addFinding(findings, {
      severity: "error", check: `audio.${role}.denoise-strength`,
      message: "denoise.strength must be a finite number within [0, 1]",
      path: `${path}.denoise.strength`,
    });
  }
}

export function validateAudioEnvelopeDeclaration(value, role, effectiveDuration, findings, path, options = {}) {
  if (!isRecord(value)) return;
  if (Object.hasOwn(value, "ducking") && typeof value.ducking !== "boolean") {
    addFinding(findings, {
      severity: "error",
      check: `audio.${role}.ducking`,
      message: "ducking must be a boolean",
      path: `${path}.ducking`,
    });
  }
  if (role === "narration" && value.ducking === true) {
    addFinding(findings, {
      severity: "warning",
      check: "audio.narration.ducking-target",
      message: "narration is a duck key and ignores ducking:true as a target",
      path: `${path}.ducking`,
    });
  }
  for (const [field, minimum, maximum] of [
    ["duck_db", -40, 0], ["duck_attack", 0, 2], ["duck_release", 0, 5],
  ]) {
    if (!Object.hasOwn(value, field)) continue;
    if (!isFiniteNumber(value[field]) || value[field] < minimum || value[field] > maximum) {
      addFinding(findings, {
        severity: "error",
        check: `audio.${role}.${field}`,
        message: `${field} must be a finite number within [${minimum}, ${maximum}]`,
        path: `${path}.${field}`,
      });
    }
  }
  if (!Object.hasOwn(value, "keyframes")) return;
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 2) {
    addFinding(findings, {
      severity: "error",
      check: "audio.keyframes.structure",
      message: "audio keyframes must contain at least two points",
      path: `${path}.keyframes`,
    });
    return;
  }
  let previousT = null;
  value.keyframes.forEach((point, index) => {
    const pointPath = `${path}.keyframes[${index}]`;
    if (!isRecord(point)) {
      addFinding(findings, { severity: "error", check: "audio.keyframes.structure", message: "keyframe must be an object", path: pointPath });
      return;
    }
    if (!isFiniteNumber(point.t) || point.t < 0) {
      addFinding(findings, { severity: "error", check: "audio.keyframes.t", message: "t must be a non-negative finite number", path: `${pointPath}.t` });
    } else {
      if (previousT !== null && point.t <= previousT) {
        addFinding(findings, {
          severity: "error",
          check: "audio.keyframes.t-order",
          message: "audio keyframe t values must be strictly increasing",
          path: `${pointPath}.t`,
        });
      }
      previousT = point.t;
      if (isFiniteNumber(effectiveDuration) && point.t > effectiveDuration + EPSILON) {
        const unit = options.v2 ? "frames" : "s";
        addFinding(findings, {
          severity: "warning",
          check: "audio.keyframes.duration",
          message: `keyframe t ${formatNumber(point.t)}${unit} exceeds effective duration ${formatNumber(effectiveDuration)}${unit}`,
          path: `${pointPath}.t`,
        });
      }
    }
    if (!isFiniteNumber(point.gain_db) || point.gain_db < -60 || point.gain_db > 12) {
      addFinding(findings, {
        severity: "error",
        check: "audio.keyframes.gain-db",
        message: "gain_db must be a finite number within [-60, 12]",
        path: `${pointPath}.gain_db`,
      });
    }
    if (options.v2) {
      for (const key of Object.keys(point)) {
        if (["t", "gain_db", "easing"].includes(key)) continue;
        addFinding(findings, {
          severity: "warning",
          check: "v2.audio-keyframe-ignored-key",
          message: `${key} is ignored on audio keyframes`,
          path: `${pointPath}.${key}`,
        });
      }
    }
  });
}

export async function validateMusicGrid(bgm, sfx, timeline, findings, skipped, paths, options) {
  if (!isRecord(bgm) || !isNonEmptyString(bgm.path)) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "audio.bgm is absent; music grid checks require audio.bgm.path",
    );
    return;
  }
  if (!Array.isArray(sfx) || sfx.length === 0) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "audio.sfx is empty; nothing to check against the music grid",
    );
    return;
  }

  const {
    declarations,
    source: declarationsSource,
    error: declarationsError,
  } = await loadMusicDeclarations(options);
  if (declarationsError) {
    addSkipped(skipped, "audio.music-grid", declarationsError);
    return;
  }
  if (!declarations) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "no declarations file found (declarations are optional)",
    );
    return;
  }

  const trackId = resolveBgmTrackId(bgm.path, declarations);
  const declaration = declarations[trackId];
  if (!declaration) {
    addSkipped(
      skipped,
      "audio.music-grid",
      `no declaration for bgm track "${trackId}" (declarations source: ${declarationsSource})`,
    );
    return;
  }

  if (timeline === null || !(timeline > 0)) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "timeline duration is unavailable (cuts are invalid or empty)",
    );
    return;
  }

  const filePath = resolveReference(paths.editPath, bgm.path, paths);
  const probed = await probeAudioDuration(filePath, options.ffprobeCommand);
  if (probed.duration === null) {
    addSkipped(
      skipped,
      "audio.music-grid",
      `bgm track duration is unavailable (${probed.reason})`,
    );
    return;
  }

  const bgmIn = isFiniteNumber(bgm.in) ? bgm.in : 0;
  const grid = musicGrid({
    declaration,
    trackDuration: probed.duration,
    bgmIn,
    timelineDuration: timeline,
  });
  const snapWindow = 0.12;
  const seamWindow = 0.3;

  for (const [index, item] of sfx.entries()) {
    if (!isRecord(item) || !isFiniteNumber(item.t)) continue;
    const itemPath = `edit.json#audio.sfx[${index}]`;
    const nearest = nearestGridPoint(item.t, grid);
    if (nearest && Math.abs(nearest.delta) > snapWindow + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "audio.sfx.music-grid",
        message: `t ${formatNumber(item.t)}s is ${formatNumber(Math.abs(nearest.delta))}s off the nearest ${nearest.kind} at ${formatNumber(nearest.t)}s (window ±${snapWindow}s)`,
        path: itemPath,
        range: { start: item.t, end: item.t },
      });
    }

    for (const seam of grid.seams) {
      if (Math.abs(item.t - seam) <= seamWindow + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.music-grid-seam",
          message: `t ${formatNumber(item.t)}s fires within ${formatNumber(seamWindow)}s of a bgm loop seam at ${formatNumber(seam)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
    }
  }
}

const GRID_KIND_ORDER = ["hit", "downbeat", "beat"];

const GRID_KIND_KEYS = {
  hit: "hits",
  downbeat: "downbeats",
  beat: "beats",
};

function nearestGridPoint(t, grid) {
  let best = null;
  for (const kind of GRID_KIND_ORDER) {
    for (const candidate of grid[GRID_KIND_KEYS[kind]] ?? []) {
      const delta = candidate - t;
      const absDelta = Math.abs(delta);
      const better =
        best === null ||
        absDelta < best.absDelta - 1e-9 ||
        (absDelta <= best.absDelta + 1e-9 &&
          GRID_KIND_ORDER.indexOf(kind) < GRID_KIND_ORDER.indexOf(best.kind));
      if (better) best = { t: candidate, kind, delta, absDelta };
    }
  }
  return best;
}

function resolveMusicLibraryRoot(env = process.env) {
  const home = env.AKARI_HOME || join(os.homedir(), ".akari");
  return join(home, "assets", "audio");
}

async function loadMusicDeclarations(options) {
  const fromEnv = process.env.AKARI_SOUNDS_DECLARATIONS
    ? resolve(process.env.AKARI_SOUNDS_DECLARATIONS)
    : null;
  const candidate =
    options.declarationsPath ??
    fromEnv ??
    join(resolveMusicLibraryRoot(), "declarations.json");
  try {
    await access(candidate, fsConstants.R_OK);
  } catch {
    return { declarations: null, source: null, error: null };
  }

  let text;
  try {
    text = await readFile(candidate, "utf8");
  } catch (error) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file could not be read: ${candidate} (${messageOf(error)})`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file is not valid JSON: ${candidate} (${messageOf(error)})`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file must be a JSON object: ${candidate}`,
    };
  }
  return { declarations: parsed, source: candidate, error: null };
}

function resolveBgmTrackId(bgmPath, declarations) {
  const baseNoExt = basename(bgmPath).replace(/\.[^./]+$/, "");
  if (Object.hasOwn(declarations, baseNoExt)) return baseNoExt;
  const parentDir = basename(dirname(bgmPath));
  if (Object.hasOwn(declarations, parentDir)) return parentDir;
  return baseNoExt;
}

export async function validateReferences(edit, findings, paths, ignoredSourceIds = new Set()) {
  const references = [];
  if (isRecord(edit?.source)) {
    references.push({ label: "source.path", value: edit.source.path, source: true });
    if (edit.source.proxy !== null && edit.source.proxy !== undefined) {
      references.push({ label: "source.proxy", value: edit.source.proxy });
    }
  }
  if (Array.isArray(edit?.sources)) {
    for (const [index, source] of edit.sources.entries()) {
      if (!isRecord(source)) continue;
      if (ignoredSourceIds.has(source.id)) continue;
      references.push({
        label: `sources[${index}].path`,
        value: source.path,
      });
      if (source.proxy !== null && source.proxy !== undefined) {
        references.push({
          label: `sources[${index}].proxy`,
          value: source.proxy,
        });
      }
    }
  }
  if (Array.isArray(edit?.overlays)) {
    for (const [index, overlay] of edit.overlays.entries()) {
      if (isInlineOverlayHtml(overlay?.html)) continue;
      references.push({
        label: `overlays[${index}].html`,
        value: overlay?.html,
      });
    }
  }
  if (isRecord(edit?.thumbnail)) {
    references.push({ label: "thumbnail.path", value: edit.thumbnail.path });
  }

  let sourceExists = false;
  for (const reference of references) {
    if (!isNonEmptyString(reference.value)) {
      addFinding(findings, {
        severity: "error",
        check: "references.files",
        message: `${reference.label} must be a non-empty file path`,
        path: `edit.json#${reference.label}`,
      });
      continue;
    }
    const binding = resolveReferenceBinding(paths.editPath, reference.value, paths);
    const filePath = binding.path;
    const exists = await isRegularFile(filePath);
    if (reference.source) sourceExists = exists;
    if (!exists) {
      addFinding(findings, {
        severity: "error",
        check: "references.files",
        message: `${reference.label} does not resolve to a regular file${unfetchedLibraryNote(binding)}`,
        path: relativePath(paths.projectRoot, filePath),
      });
    }
  }
  return { sourceExists };
}
