import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderLintReport } from "./report.mjs";
import { isSourceCompatibleWithLane } from "./shape-lane.mjs";
import { collectLicenseFindings } from "./license-findings.mjs";
import { describeFragmentAssetHint, extractFragmentAssetReferences, extractAbsoluteFragmentAssetReferences } from "../../render-cut/src/fragment-assets.mjs";
import { readFontCodepoints } from "../../render-cut/src/font-cmap.mjs";
import { collectFragmentCodepoints, fragmentFontFaces } from "../../render-cut/src/fragment-text.mjs";
import { htmlTags, rawTextElements, stripHtmlComments } from "../../render-cut/src/html-scan.mjs";
import { deriveTracks } from "./derive-tracks.mjs";
import { segmentDuration } from "./cut-timeline.mjs";
import { validateWorldSceneDeclaration } from "./world-scene-declaration.mjs";
import {
  readProjectReferences,
  resolveAssetLibraryRoots,
  resolveLibraryFallback,
} from "./library-reference.mjs";
import { inspectHtmlFragment, parseHtmlAttributes } from "./lint/html-fragment.mjs";
import {
  parseOverlayStyles,
  splitCssTopLevel,
  missingProperties,
  normalizeMotionSelector,
  referencedKeyframeNames,
  baseHiddenState,
  endpointClearsHiddenState,
} from "./lint/overlay-css.mjs";
import { ExecutionError, EPSILON, effectiveSourceOut, readRequiredText, resolveReferenceBinding, isRegularFileSync, isRegularFile, structureFinding, addFinding, addSkipped, relativePath, isRecord, isFiniteNumber, isPositiveNumber, isNonEmptyString, numbersEqual, formatNumber, messageOf } from "./lint/shared.mjs";
import { readInternalEdit, projectLegacyEdit, timelineDurationSeconds, collectFitBasisCandidates, areCutsAdjacent, cutOverlapFrames, isStillImageSourcePath, planTransitionHandleWindow, findCrossTrackLayerEvacuations, withoutItemAnchors, captionsHaveRenderableCues, resolveItemAnchors, toAnchorCaptions, TRANSITION_TYPE_IDS, findUnsupportedDeclaredTrackTransitions } from "./lint/external.mjs";
import { runReferencedMediaChecks, runSourceVfrChecks, validateProxyGops } from "./lint/media-checks.mjs";
import { lintDecisionLogPredict, validateIntake } from "./lint/intake.mjs";
import { validateReview } from "./lint/review.mjs";
import { validateEngineCapabilities } from "./lint/engine-capabilities.mjs";
import { validateCaptions } from "./lint/captions.mjs";
import { validateAudioDuckKeys, validateBgmSfx, validateLegacyNarrationTrim, validateMusicGrid, validateNarration, validateReferences, validateAudioClipFxDeclaration, validateAudioEnvelopeDeclaration } from "./lint/audio.mjs";
import { validateChromaKey, validateLook, validateAdjust } from "./lint/look-adjust.mjs";
export { ExecutionError } from "./lint/shared.mjs";
export { findCropScaleProxyRatioFindings } from "./lint/media-checks.mjs";
export { INTAKE_ROOT_FIELDS } from "./lint/intake.mjs";
export { validateCaptionRunRanges } from "./lint/captions.mjs";

const VERSION = 1;
const MOTION_IN_OUT_PRESETS = new Set(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "scale", "wipe", "pop", "zoom", "twirl"]);
const MOTION_LOOP_PRESETS = new Set(["pulse", "float", "spin", "blink", "jiggle"]);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const USAGE = `Usage: edit-lint <project-root|edit.json path> [--media] [--json] [--no-reports] [--engine gpu|osr|auto]
       [--silence-error-seconds N] [--max-volume-error-db N]
       [--caption-silence-warn-percent N]
       [--declarations PATH] [--ffprobe PATH]

Relative paths in edit.json resolve from the nearest ancestor containing .akari/ (or the edit file directory).
Exit codes: 0 PASS, 1 FAIL, 2 execution error`;

export function loadTextstylePresetIds(repoRoot) {
  try {
    return new Set(
      readFileSync(join(repoRoot, "presets/textstyle/index.jsonl"), "utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line).id)
        .filter((id) => typeof id === "string"),
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

const PROVIDER_GUIDANCE = 'provenance.provider は必須です（例: {"provider":"voicevox","credit":"VOICEVOX:ずんだもん"} / "fal" / "human"）';

function providerGuidedMessage(error) {
  const message = messageOf(error);
  return /\.provenance\.provider\)/u.test(message) && !message.includes(PROVIDER_GUIDANCE)
    ? `${message}。${PROVIDER_GUIDANCE}` : message;
}

function readEditWithProviderGuidance(edit, options) {
  try {
    return readInternalEdit(edit, options);
  } catch (error) {
    error.message = providerGuidedMessage(error);
    throw error;
  }
}

export async function runCli(argv, io = console) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.error(error.message);
    io.error(USAGE);
    return 2;
  }

  if (options.help) {
    io.log(USAGE);
    return 0;
  }

  try {
    const result = await lintProject(options.input, options);
    if (options.json) {
      io.log(JSON.stringify(result, null, 2));
    } else {
      io.log(
        `${result.verdict.toUpperCase()}: ${options.input} (${result.findings.length} findings, ${result.skipped.length} skipped)`,
      );
      for (const finding of result.findings) {
        io.log(
          `- [${finding.severity}] ${finding.check}: ${finding.message}${finding.path ? ` (${finding.path})` : ""}`,
        );
      }
    }
    return result.verdict === "pass" ? 0 : 1;
  } catch (error) {
    io.error(`edit-lint execution error: ${providerGuidedMessage(error)}`);
    return 2;
  }
}

export async function lintProject(input, options = {}) {
  const paths = await resolveInput(input, options);
  const findings = [];
  const skipped = [];
  const inputs = {};
  const editText = await readRequiredText(
    paths.editPath,
    "edit.json",
    inputOverride(options, paths.projectRoot, paths.editPath),
  );
  inputs.edit_json_sha256 = sha256(editText);

  let edit;
  try {
    edit = JSON.parse(editText);
  } catch (error) {
    throw new ExecutionError(`edit.json is not valid JSON: ${messageOf(error)}`);
  }

  const engine = parseEngine(options.engine ?? null);
  const engineCapabilities = engine === null ? null : readEngineCapabilities(options);
  if (engineCapabilities !== null) {
    inputs.engine_capabilities_sha256 = sha256(engineCapabilities.text);
    if (!isRecord(edit) || edit.version !== 2) {
      addSkipped(skipped, "engine.capabilities", "v2 のみ対応");
    }
  }

  if (isRecord(edit) && Number.isInteger(edit.version) && edit.version > 2) {
    addFinding(findings, {
      severity: "error",
      check: "edit.version",
      message: `edit.json version ${edit.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      path: "edit.json#version",
    });
    addSkipped(
      skipped,
      "edit.validation",
      "a newer edit.json version was detected; no format assumptions were made",
    );
    return writeResult(findings, skipped, inputs, paths, options);
  }

  if (isRecord(edit) && edit.version !== 2) readEditWithProviderGuidance(edit);
  validateEditV2(edit, findings);
  if (isRecord(edit) && edit.version === 2) {
    await validateV2ObjectTreeFiles(edit, findings, paths);
  }
  if (findings.some(finding => finding.severity === "error")) {
    return writeResult(findings, skipped, inputs, paths, options);
  }
  const rawEdit = edit.version === 2 && edit.sources === undefined
    ? { ...edit, sources: [] } : edit;
  const internalEdit = readEditWithProviderGuidance(rawEdit, { allowCutAudioSplit: true });
  const legacyEdit = projectLegacyEdit(internalEdit);
  if (engineCapabilities !== null && rawEdit.version === 2) {
    validateEngineCapabilities(rawEdit, internalEdit, engine, engineCapabilities.value, findings);
  }
  validateTransitionLayerEvacuations(rawEdit, internalEdit, findings);
  validateGeometryFitCompat(rawEdit, internalEdit, findings);
  const rawAudio = isRecord(rawEdit.audio) ? rawEdit.audio : {};
  if (rawEdit.version === 2) {
    validateLegacyNarrationTrim(rawAudio.narration, findings);
  }
  const projectedAudio = projectAudioForLint(internalEdit);
  edit = {
    ...rawEdit,
    ...legacyEdit,
    overlays: internalEdit.tracks.flatMap(track => track.items)
      .filter(item => item.source.kind === "html")
      .map(item => item.declaration),
    version: 1,
    output: rawEdit.output,
    audio: {
      ...rawAudio,
      ...projectedAudio,
    },
  };

  const analysisState = await readOptionalJson(
    paths.analysisPath,
    "analysis.json",
    inputOverride(options, paths.projectRoot, paths.analysisPath),
  );
  if (analysisState.exists) {
    inputs.analysis_json_sha256 = sha256(analysisState.text);
    if (analysisState.error) {
      addFinding(findings, {
        severity: "error",
        check: "analysis.schema",
        message: `analysis.json is not valid JSON: ${analysisState.error}`,
        path: relativePath(paths.projectRoot, paths.analysisPath),
      });
    }
  } else {
    addSkipped(
      skipped,
      "analysis.json",
      "analysis.json is absent",
    );
  }

  const captionsState = await readOptionalJson(
    paths.captionsPath,
    "captions.json",
    inputOverride(options, paths.projectRoot, paths.captionsPath),
  );
  if (captionsState.exists) {
    inputs.captions_json_sha256 = sha256(captionsState.text);
    if (captionsState.error) {
      addFinding(findings, {
        severity: "error",
        check: "captions.schema",
        message: `captions.json is not valid JSON: ${captionsState.error}`,
        path: relativePath(paths.projectRoot, paths.captionsPath),
      });
    }
  } else {
    addSkipped(skipped, "captions", "captions.json is absent");
  }
  if (isRecord(rawEdit) && rawEdit.version === 2) {
    validateV2ItemAnchors(rawEdit, captionsState, findings);
  }
  validateCaptionTrackDeclaration(rawEdit, captionsState.value, findings);

  const reviewState = await readOptionalJson(
    paths.reviewPath,
    "review.json",
    inputOverride(options, paths.projectRoot, paths.reviewPath),
  );
  if (reviewState.exists) {
    inputs.review_json_sha256 = sha256(reviewState.text);
    if (reviewState.error) {
      addFinding(findings, {
        severity: "error",
        check: "review.schema",
        message: `review.json is not valid JSON: ${reviewState.error}`,
        path: relativePath(paths.projectRoot, paths.reviewPath),
      });
    }
  } else {
    addSkipped(skipped, "review", "review.json is absent");
  }

  const intakeState = await readOptionalJson(
    paths.intakePath,
    "intake.json",
    inputOverride(options, paths.projectRoot, paths.intakePath),
  );
  if (intakeState.exists) {
    inputs.intake_json_sha256 = sha256(intakeState.text);
    if (intakeState.error) {
      addFinding(findings, {
        severity: "error",
        check: "intake.schema",
        message: `intake.json is not valid JSON: ${intakeState.error}`,
        path: relativePath(paths.projectRoot, paths.intakePath),
      });
    }
  } else {
    addSkipped(skipped, "intake", ".akari/intake.json is absent");
  }

  const structure = validateEditStructure(edit, findings, paths);
  const sourcePath = structure.sourcePath;
  const audioOnlySourceIds = collectAudioOnlySourceIds(rawEdit);
  const referenceState = await validateReferences(edit, findings, paths, audioOnlySourceIds);
  findings.push(...await collectLicenseFindings(edit, sourcePath =>
    resolveReferenceBinding(paths.editPath, sourcePath, paths).path));
  await validateProxyGops(rawEdit, findings, paths, options);
  const cutsStructureResult = validateCuts(
    edit.cuts,
    findings,
    paths,
    structure.sourceIds,
  );
  // 全素材の最大終端を出力尺とする。外部字幕の output 区間も同じ出力軸へ加える。
  // cuts が構造的に不正なら下流の尺検証は止める。
  const timelineDuration = cutsStructureResult === null ? null : timelineDurationSeconds(internalEdit);
  const captionRows = Array.isArray(captionsState.value) ? captionsState.value
    : Array.isArray(captionsState.value?.captions) ? captionsState.value.captions : [];
  const outputCaptionEnd = captionRows.reduce((end, cue) =>
    cue?.time_domain === 'output' && Number.isFinite(cue.end) ? Math.max(end, cue.end) : end, 0);
  const timeline = timelineDuration ? Math.max(timelineDuration.seconds, outputCaptionEnd) : null;
  if (timelineDuration?.basis === "overlays-audio") {
    addFinding(findings, {
      severity: "info",
      check: "timeline.duration-derived",
      message: `尺を overlays / 字幕 / 音声の終端 ${formatNumber(timeline)} 秒から導出した`,
      path: "edit.json#tracks",
    });
  }
  validateCutTrackFields(edit.cuts, findings);
  validateCutTransformFields(edit.cuts, findings);
  validateStillImageCuts(edit, findings);
  const cutTrackSegments = computeCutTrackSegments(edit.cuts);
  validateTransitionAdjacency(edit.cuts, cutTrackSegments, edit.sources, edit.fps, findings);
  // v2.track-no-overlap above checks the actual track IDs before legacy projection.
  // A mixed telop/media track may project its media into cuts with the same numeric
  // ref as another physical track. Those per-kind aliases are not v2 track identity;
  // checking projected cuts again would reject valid cross-track composition.
  validateDurationMaximum(edit.outputs, timeline, findings, paths);
  validateOutputAxisDurationMax(edit.outputs, cutTrackSegments, findings);
  await validateOverlays(edit.overlays, timeline, findings, paths);
  validateOverlayBackgroundRole(edit.overlays, findings);
  await validateNarration(edit?.audio?.narration, timeline, findings, paths);
  await validateBgmSfx(edit?.audio?.bgm, edit?.audio?.sfx, timeline, findings, paths);
  validateAudioDuckKeys(edit?.audio?.duck_keys, findings);
  await validateMusicGrid(
    edit?.audio?.bgm,
    edit?.audio?.sfx,
    timeline,
    findings,
    skipped,
    paths,
    options,
  );
  validateSfxTracks(edit?.audio?.sfx, findings);
  validateAudioMaster(edit?.audio?.master, findings, "edit.json#audio.master");
  validateOutputEncoding(edit?.output?.encoding, findings, "edit.json#output.encoding");
  validateLayerTracks(edit.layers, findings);
  validateTimelineTracks(edit, findings, collectInternalAudioTrackRefs(internalEdit));
  validateTrackTransitionOutCompatibility(edit, findings);

  if (captionsState.value !== undefined) {
    const cutsEndSeconds = cutTrackSegments.reduce(
      (maximum, segment) => Math.max(maximum, segment.end),
      0,
    );
    validateCaptions(
      captionsState.value,
      edit,
      analysisState.value,
      findings,
      paths,
      cutsEndSeconds,
      loadTextstylePresetIds(options.textstyleRepositoryRoot ?? REPOSITORY_ROOT),
    );
  }

  if (reviewState.value !== undefined) {
    await validateReview(reviewState.value, edit, findings, paths, skipped);
  }

  if (intakeState.value !== undefined) {
    validateIntake(intakeState.value, findings, paths);
  }
  await lintDecisionLogPredict({ projectRoot: paths.projectRoot, intake: intakeState.value, edit: rawEdit, findings });
  runSourceVfrChecks(rawEdit, edit, findings, paths);

  if (options.media) {
    runReferencedMediaChecks(
      rawEdit,
      edit,
      findings,
      skipped,
      paths,
      options,
      captionsState.value,
    );
  } else {
    addSkipped(skipped, "media", "media checks require --media");
  }

  return writeResult(findings, skipped, inputs, paths, options);
}

/**
 * 幾何の統一 G1: `output.geometry` を持たない v2 文書は fit 互換モード（出力へ contain fit した後に
 * transform）で描かれる。実寸基準へ移行できる media item があることを 1 件の warning で知らせる。
 * error にはしない（既存プロジェクトの CI を壊さないため）。移行後（`"source"`）は出さない。
 */
function validateGeometryFitCompat(rawEdit, internalEdit, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2) return;
  if (isRecord(rawEdit.output) && rawEdit.output.geometry === "source") return;
  if (collectFitBasisCandidates(internalEdit).length === 0) return;
  addFinding(findings, {
    severity: "warning",
    check: "geometry.fit-compat",
    message: "fit 互換モードで描画中。`normalize-geometry` で実寸基準へ移行できます",
    path: "edit.json#output.geometry",
  });
}

function validateTransitionAdjacency(cuts, segments, sources, fps, findings) {
  const sourcePaths = new Map((Array.isArray(sources) ? sources : [])
    .filter(source => isRecord(source) && typeof source.id === "string")
    .map(source => [source.id, source.path]));
  const isStillCut = cut => isStillImageSourcePath(sourcePaths.get(cut?.src) ?? cut?.src);
  for (let position = 0; position < segments.length; position += 1) {
    const earlier = segments[position];
    const transition = cuts?.[earlier.index]?.transition_out;
    if (!isRecord(transition) || !isPositiveNumber(transition.duration)) continue;
    const later = segments.slice(position + 1).find(candidate => candidate.track === earlier.track);
    if (!later) continue;
    const overlapFrames = cutOverlapFrames(
      { tlEnd: earlier.end },
      { tlStart: later.start },
      fps,
    );
    if (overlapFrames === 0) {
      const outgoingCut = cuts?.[earlier.index];
      const incomingCut = cuts?.[later.index];
      const incomingSpeed = isPositiveNumber(incomingCut?.speed) ? incomingCut.speed : 1;
      const plan = planTransitionHandleWindow({
        declaredSeconds: transition.duration,
        outgoingTailRoomSeconds: Number.POSITIVE_INFINITY,
        incomingHeadRoomSeconds: isStillCut(incomingCut)
          ? Number.POSITIVE_INFINITY : Math.max(0, Number(incomingCut?.in) || 0) / incomingSpeed,
        outgoingDurationSeconds: Math.max(0, earlier.end - earlier.start),
        incomingDurationSeconds: Math.max(0, later.end - later.start),
      });
      if (plan.effectiveSeconds <= 0) {
        addFinding(findings, {
          severity: "warning",
          check: "cuts.transition-out.zero-overlap",
          message: "トランジションを宣言していますが、のりしろにできる素材の余りがないため効きません。素材のトリムを調整するか、トランジションを削除してください。",
          path: `edit.json#cuts[${earlier.index}].transition_out`,
          range: { start: earlier.end, end: later.start },
        });
      }
      continue;
    }
    // 正の重なりは、宣言尺未満なら既存の短縮クランプ、宣言尺超なら track-overlap が担当する。
    if (overlapFrames > 0 || areCutsAdjacent(
      { tlEnd: earlier.end, transitionOut: { duration: transition.duration } },
      { tlStart: later.start },
      fps,
    )) continue;
    addFinding(findings, {
      severity: "error",
      check: "cuts.transition-out.non-adjacent",
      message: "transition_out の次のクリップとの間にすき間があります。すき間を詰めるか、トランジションを削除してください。",
      path: `edit.json#cuts[${earlier.index}].transition_out`,
      range: { start: earlier.end, end: later.start },
    });
  }
}

function validateTransitionLayerEvacuations(rawEdit, internalEdit, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2) return;
  const crossTrackCauses = new Map();
  for (const cause of findCrossTrackLayerEvacuations(withoutItemAnchors(rawEdit))) {
    if (!crossTrackCauses.has(cause.itemId)) crossTrackCauses.set(cause.itemId, cause);
  }
  const rawLocations = new Map();
  if (Array.isArray(rawEdit.tracks)) {
    rawEdit.tracks.forEach((track, trackIndex) => {
      if (!isRecord(track) || !Array.isArray(track.items)) return;
      track.items.forEach((item, itemIndex) => {
        if (isRecord(item) && typeof item.id === "string") {
          rawLocations.set(item.id, { trackIndex, itemIndex });
        }
      });
    });
  }
  for (const track of internalEdit.tracks) {
    for (const item of track.items) {
      const transition = item.declaration?.transition_out;
      if (item.legacy.collection !== "layers" || !isRecord(transition)) continue;
      const location = rawLocations.get(item.id);
      const cause = crossTrackCauses.get(item.id);
      const reason = cause
        ? `このクリップは他トラックのアイテム（${cause.causeItemId}）と重なっているため PiP 経路へ退避され、宣言したトランジションは書き出されません。`
        : "このクリップは合成機能または同一トラック内の重なりにより PiP 経路へ退避され、宣言したトランジションは書き出されません。";
      addFinding(findings, {
        severity: "warning",
        check: "cuts.transition-out.layer-evacuated",
        message: `${reason}重なりを解消するか、トランジションを削除してください。`,
        path: location
          ? `edit.json#tracks[${location.trackIndex}].items[${location.itemIndex}].source.transition_out`
          : `edit.json#tracks[${track.z}].items`,
        ...(cause ? {
          range: {
            start: cause.overlapStartFrames / internalEdit.output.fps,
            end: cause.overlapEndFrames / internalEdit.output.fps,
          },
        } : {}),
      });
    }
  }
}

export function validateCaptionTrackDeclaration(rawEdit, captionsRoot, findings) {
  if (!isRecord(rawEdit) || rawEdit.version !== 2
    || !captionsHaveRenderableCues(captionsRoot)) return;
  const declared = Array.isArray(rawEdit.tracks) && rawEdit.tracks.some(
    track => isDeclaredCaptionTrack(track),
  );
  if (declared) return;
  addFinding(findings, {
    severity: "warning",
    check: "v2.captions-track-undeclared",
    message: 'captions.json に描画対象 cue がありますが字幕トラックが未宣言です。現状は暗黙補完で表示自体はされています。visual トラックの items[] に { "id": "captions", "name": "字幕", "at": 0, "duration": <出力尺>, "source": { "kind": "captions", "path": "captions.json" }, "items": [] } を追加してください。',
    path: "edit.json#tracks",
  });
}

function isDeclaredCaptionTrack(track) {
  return isRecord(track) && (
    (isRecord(track.content) && track.content.from === "captions.json")
    || (Array.isArray(track.items) && track.items.some(
      item => isRecord(item) && isRecord(item.source) && item.source.kind === "captions",
    ))
  );
}

function projectAudioForLint(internalEdit) {
  const sfx = [];
  const narration = [];
  let bgm;
  for (const track of internalEdit.tracks) {
    if (track.lane !== "audio") continue;
    for (const item of track.items) {
      if (!isRecord(item.declaration)) continue;
      const declaration = { ...item.declaration };
      if (item.legacy.collection === "sfx") sfx.push(declaration);
      if (item.legacy.collection === "narration") narration.push(declaration);
      if (item.legacy.collection === "bgm") bgm = declaration;
    }
  }
  return {
    ...(sfx.length > 0 ? { sfx } : {}),
    ...(narration.length > 0 ? { narration } : {}),
    ...(bgm !== undefined ? { bgm } : {}),
  };
}

function collectAudioOnlySourceIds(edit) {
  if (!Array.isArray(edit?.tracks)) return new Set();
  const audio = new Set();
  const visual = new Set();
  for (const track of edit.tracks) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    for (const item of track.items) {
      const sourceId = isRecord(item?.source) && item.source.kind === "media"
        ? item.source.src : undefined;
      if (!isNonEmptyString(sourceId)) continue;
      if (track.lane === "audio") audio.add(sourceId);
      if (track.lane === "visual") visual.add(sourceId);
    }
  }
  return new Set([...audio].filter(sourceId => !visual.has(sourceId)));
}

function collectInternalAudioTrackRefs(internalEdit) {
  return new Set(internalEdit.tracks
    // v2 top-level audio は読み込み層が implicit audio track へ射影するが、元データに
    // tracks[] 宣言は無い。これを実段として数えると declaration-missing が必ず出る。
    // validateTimelineTracks が照合する相手は projectLegacyEdit の declaredTracks なので、
    // 実データ側も同じ declared origin に限定して投影ノイズを除く。
    .filter(track => track.origin === "declared" && track.lane === "audio" && track.items.length > 0)
    .map(track => Number.isInteger(track.legacy.ref) ? track.legacy.ref : 0));
}

async function writeResult(findings, skipped, inputs, paths, options) {
  const normalizedFindings = finalizeFindings(findings);
  const normalizedSkipped = finalizeSkipped(skipped);
  const result = {
    version: VERSION,
    checked_at: options.checkedAt ?? new Date().toISOString(),
    inputs: sortObject(inputs),
    verdict: normalizedFindings.some((finding) => finding.severity === "error")
      ? "fail"
      : "pass",
    findings: normalizedFindings,
    skipped: normalizedSkipped,
  };

  if (options.writeReports === false) {
    return result;
  }

  const lintDirectory = join(paths.projectRoot, ".akari");
  const reportsDirectory = join(lintDirectory, "reports");
  const lintPath = join(lintDirectory, "lint.json");
  const reportPath = join(reportsDirectory, "edit-lint-report.html");
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(lintPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(
    reportPath,
    renderLintReport(result, reportPath, paths.projectRoot),
    "utf8",
  );

  return result;
}

export function parseArguments(argv) {
  let input = null;
  const options = {
    media: false,
    json: false,
    writeReports: true,
    silenceErrorSeconds: null,
    maxVolumeErrorDb: null,
    captionSilenceWarnPercent: null,
    declarationsPath: null,
    ffprobeCommand: null,
    engine: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--media") {
      options.media = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--no-reports") {
      options.writeReports = false;
      continue;
    }
    if (argument === "--engine") {
      options.engine = parseEngine(argv[++index]);
      if (options.engine === null) throw new ExecutionError("--engine requires gpu, osr, or auto");
      continue;
    }
    if (argument.startsWith("--engine=")) {
      options.engine = parseEngine(argument.slice("--engine=".length));
      if (options.engine === null) throw new ExecutionError("--engine requires gpu, osr, or auto");
      continue;
    }
    if (argument === "--silence-error-seconds") {
      options.silenceErrorSeconds = parseThreshold(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--silence-error-seconds=")) {
      options.silenceErrorSeconds = parseThreshold(
        argument.slice("--silence-error-seconds=".length),
        "--silence-error-seconds",
      );
      continue;
    }
    if (argument === "--max-volume-error-db") {
      options.maxVolumeErrorDb = parseNumber(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--max-volume-error-db=")) {
      options.maxVolumeErrorDb = parseNumber(
        argument.slice("--max-volume-error-db=".length),
        "--max-volume-error-db",
      );
      continue;
    }
    if (argument === "--caption-silence-warn-percent") {
      options.captionSilenceWarnPercent = parseNumber(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--caption-silence-warn-percent=")) {
      options.captionSilenceWarnPercent = parseNumber(
        argument.slice("--caption-silence-warn-percent=".length),
        "--caption-silence-warn-percent",
      );
      continue;
    }
    if (argument === "--declarations") {
      const value = argv[++index];
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--declarations requires a path");
      }
      options.declarationsPath = resolve(value);
      continue;
    }
    if (argument.startsWith("--declarations=")) {
      const value = argument.slice("--declarations=".length);
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--declarations requires a path");
      }
      options.declarationsPath = resolve(value);
      continue;
    }
    if (argument === "--ffprobe") {
      const value = argv[++index];
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--ffprobe requires a path");
      }
      options.ffprobeCommand = value;
      continue;
    }
    if (argument.startsWith("--ffprobe=")) {
      const value = argument.slice("--ffprobe=".length);
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--ffprobe requires a path");
      }
      options.ffprobeCommand = value;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new ExecutionError(`Unknown option: ${argument}`);
    }
    if (input !== null) throw new ExecutionError("Only one input path may be provided");
    input = argument;
  }

  if (input === null) throw new ExecutionError("An input path is required");
  return { input, ...options };
}

function parseEngine(value) {
  if (value === null || value === undefined) return null;
  if (["gpu", "osr", "auto"].includes(value)) return value;
  throw new ExecutionError("--engine requires gpu, osr, or auto");
}

function readEngineCapabilities(options) {
  let text;
  try {
    if (typeof options.engineCapabilitiesText === "string") {
      text = options.engineCapabilitiesText;
    } else if (isRecord(options.engineCapabilities)) {
      text = `${JSON.stringify(options.engineCapabilities, null, 2)}\n`;
    } else if (typeof options.engineCapabilitiesPath === "string") {
      text = readFileSync(options.engineCapabilitiesPath, "utf8");
    } else {
      const checkout = new URL("../../schemas/engine-capabilities.json", import.meta.url);
      const bundled = new URL("./engine-capabilities.json", import.meta.url);
      text = readFileSync(existsSync(checkout) ? checkout : bundled, "utf8");
    }
  } catch (error) {
    const location = options.engineCapabilitiesPath
      ? `指定された対応表 ${options.engineCapabilitiesPath}`
      : "同梱漏れ: packages/edit-lint/src/engine-capabilities.json または packages/schemas/engine-capabilities.json";
    throw new ExecutionError(`engine capability table cannot be read (${location}): ${messageOf(error)}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ExecutionError(`engine capability table is not valid JSON: ${messageOf(error)}`);
  }
  if (!isRecord(value) || !Array.isArray(value.fields) || !Array.isArray(value.engines)) {
    throw new ExecutionError("engine capability table has an invalid shape");
  }
  return { text, value };
}

async function resolveInput(input, options = {}) {
  const absolute = resolve(input);
  let inputStats;
  try {
    inputStats = await stat(absolute);
  } catch (error) {
    throw new ExecutionError(`Input cannot be read: ${messageOf(error)}`);
  }

  const editPath = options.editPath
    ? resolve(options.editPath)
    : inputStats.isDirectory()
      ? join(absolute, "edit.json")
      : absolute;
  if (!options.editPath && !inputStats.isDirectory() && basename(absolute) !== "edit.json") {
    throw new ExecutionError("Input file must be named edit.json");
  }
  let projectRoot = dirname(editPath);
  for (let current = projectRoot; ; current = dirname(current)) {
    if (existsSync(join(current, ".akari")) && statSync(join(current, ".akari")).isDirectory()) {
      projectRoot = current;
      break;
    }
    if (dirname(current) === current) break;
  }
  return {
    projectRoot,
    editPath,
    analysisPath: join(projectRoot, "analysis.json"),
    captionsPath: join(projectRoot, "captions.json"),
    reviewPath: join(projectRoot, "review.json"),
    intakePath: join(projectRoot, ".akari", "intake.json"),
    assetReferences: readProjectReferences(projectRoot),
    libraryRoots: resolveAssetLibraryRoots(options.env ?? process.env).read,
  };
}

function validateEditStructure(edit, findings, paths) {
  const editRelative = relativePath(paths.projectRoot, paths.editPath);
  if (!isRecord(edit)) {
    addFinding(findings, { severity: "error", check: "edit.structure", message: "edit.json root must be an object", path: editRelative });
    return { sourcePath: null, sourceIds: new Set() };
  }
  if (!isRecord(edit.output)) {
    structureFinding(findings, editRelative, "output must be an object");
  } else {
    for (const field of ["width", "height", "fps"]) {
      if (!isPositiveNumber(edit.output[field])) structureFinding(findings, editRelative, `output.${field} must be a positive number`);
    }
    validateLook(edit.output.look, findings, "edit.json#output.look");
  }
  const sourceIds = new Set();
  if (!Array.isArray(edit.sources) && !(edit.version === 2 && edit.sources === undefined)) {
    structureFinding(findings, editRelative, "sources must be an array");
  } else {
    for (const [index, source] of edit.sources.entries()) {
      const sourceRelative = `edit.json#sources[${index}]`;
      if (!isRecord(source)) {
        structureFinding(findings, sourceRelative, "source must be an object");
        continue;
      }
      if (!isNonEmptyString(source.id)) {
        structureFinding(findings, sourceRelative, "source id must be a non-empty string");
      } else if (sourceIds.has(source.id)) {
        addFinding(findings, { severity: "error", check: "sources.id", message: `duplicate source id: ${source.id}`, path: sourceRelative });
      } else {
        sourceIds.add(source.id);
      }
      if (!isNonEmptyString(source.path)) structureFinding(findings, sourceRelative, "source path must be a non-empty string");
      if (source.proxy !== null && source.proxy !== undefined && !isNonEmptyString(source.proxy)) {
        structureFinding(findings, sourceRelative, "source proxy must be null or a non-empty string");
      }
      validateChromaKey(source.chroma_key, findings, `${sourceRelative}.chroma_key`);
    }
  }
  if (!Array.isArray(edit.cuts)) structureFinding(findings, editRelative, "cuts must be an array");
  if (!Array.isArray(edit.overlays)) structureFinding(findings, editRelative, "overlays must be an array");
  return { sourcePath: null, sourceIds };
}

// notes-2026-08-18-timeline-latency-and-track-model.md §9 / §10-1。
// v2 Phase 0 は既存 v0/v1 の検証パイプラインへ混ぜず、トラック正本の最小不変条件だけを検査する。
function validateAnimatorRefs(item, points, findings, keyframesPath) {
  if (!Array.isArray(points)) return;
  const ids = new Set((Array.isArray(item.animator) ? item.animator : [])
    .filter(isRecord).map(animator => animator.id));
  for (const [index, point] of points.entries()) {
    if (!isRecord(point) || !isRecord(point.animator)) continue;
    for (const id of Object.keys(point.animator)) {
      if (ids.has(id)) continue;
      addFinding(findings, {
        severity: "error", check: "animator.unknown-ref",
        message: `keyframe references undeclared animator id: ${id}`,
        path: `${keyframesPath}[${index}].animator[${JSON.stringify(id)}]`,
      });
    }
  }
}

function validateAnimators(item, findings, itemPath) {
  if (Object.hasOwn(item, "animator") && ["media", "filter"].includes(item.source?.kind)) {
    addFinding(findings, {
      severity: "warning", check: "animator.non-text-target",
      message: "animator is ignored on non-text items",
      path: `${itemPath}.animator`,
    });
  }
  const ids = new Set();
  for (const [index, animator] of (Array.isArray(item.animator) ? item.animator : []).entries()) {
    if (!isRecord(animator)) continue;
    if (isNonEmptyString(animator.id)) {
      if (ids.has(animator.id)) addFinding(findings, {
        severity: "error", check: "animator.duplicate-id",
        message: `duplicate animator id: ${animator.id}; last declaration wins when rendering`,
        path: `${itemPath}.animator[${index}].id`,
      });
      ids.add(animator.id);
    }
    if (animator.basis === "segments") addFinding(findings, {
      severity: "warning", check: "animator.segments-fallback",
      message: "animator basis segments uses words in v1",
      path: `${itemPath}.animator[${index}].basis`,
    });
  }
  validateAnimatorRefs(item, item.keyframes, findings, `${itemPath}.keyframes`);
}

function validateEditV2(edit, findings) {
  validateAudioDuckKeys(edit?.audio?.duck_keys, findings);
  if (!Array.isArray(edit.tracks)) {
    addFinding(findings, {
      severity: "error",
      check: "v2.track-content-exclusive",
      message: "version 2 tracks must be an array",
      path: "edit.json#tracks",
    });
    return;
  }

  const sourceIds = new Map();
  const sourcePaths = new Map();
  const trackIds = new Map();
  const itemIds = new Map();
  const itemTargets = new Map();
  const linkedAudioItems = [];
  const registerId = (ids, id, path, label) => {
    if (!isNonEmptyString(id)) {
      addFinding(findings, {
        severity: "error",
        check: "v2.id-unique",
        message: `${label} id must be a non-empty string`,
        path,
      });
      return;
    }
    const first = ids.get(id);
    if (first) {
      addFinding(findings, {
        severity: "error",
        check: "v2.id-unique",
        message: `${label} id is duplicated: ${id} (first declared at ${first})`,
        path,
      });
      return;
    }
    ids.set(id, path);
  };

  if (Array.isArray(edit.sources)) {
    for (const [index, source] of edit.sources.entries()) {
      if (isRecord(source)) {
        registerId(sourceIds, source.id, `edit.json#sources[${index}].id`, "source");
        if (isNonEmptyString(source.id)) sourcePaths.set(source.id, source.path);
      }
    }
  }

  const fps = edit.output?.fps;

  for (const [trackIndex, track] of edit.tracks.entries()) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    const visit = (items, parent, parentPath) => {
      for (const [index, item] of items.entries()) {
        const itemPath = `${parentPath}[${index}]`;
        if (!isRecord(item)) continue;
        registerId(itemIds, item.id, `${itemPath}.id`, "item");
        validateAnimators(item, findings, itemPath);
        if (isNonEmptyString(item.id) && !itemTargets.has(item.id)) {
          itemTargets.set(item.id, { item, lane: track.lane });
        }
        if (track.lane === "audio" && Object.hasOwn(item, "link")) {
          linkedAudioItems.push({ item, path: `${itemPath}.link` });
        }
        if (isPositiveNumber(fps) && Number.isInteger(item.duration) && item.duration > 0) {
          const duration = item.duration;
          const seconds = (duration / fps).toFixed(2);
          if (track.lane !== "audio" && item.source?.kind !== "caption"
            && duration < Math.round(0.5 * fps)) {
            addFinding(findings, {
              severity: "warning", check: "v2.item-duration-short",
              message: `item ${String(item.id)} の duration は ${duration} フレーム（${seconds} 秒）です。at / duration の単位はフレームです。${duration} 秒のつもりなら ${formatNumber(duration * fps)} フレームにしてください（×fps = ${formatNumber(fps)}）。`,
              path: `${itemPath}.duration`,
            });
          }
          const source = item.source;
          if (source?.kind === "media" && isFiniteNumber(source.out)
            && !isStillImageSourcePath(sourcePaths.get(source.src)) && !isRecord(source.freeze)) {
            const sourceIn = source.in ?? 0;
            const sourceSeconds = (effectiveSourceOut(item, fps) - sourceIn)
              / (isPositiveNumber(source.speed) ? source.speed : 1);
            const timelineSeconds = duration / fps;
            const ratio = Math.max(sourceSeconds / timelineSeconds, timelineSeconds / sourceSeconds);
            if (sourceSeconds > 0 && ratio >= 5) {
              addFinding(findings, {
                severity: "warning", check: "v2.item-duration-source-mismatch",
                message: `item ${String(item.id)} の duration ${duration} フレーム（${seconds} 秒）と source の区間 in ${formatNumber(sourceIn)} 秒 〜 out ${formatNumber(source.out)} 秒（${sourceSeconds.toFixed(2)} 秒${isPositiveNumber(source.speed) && source.speed !== 1 ? `・speed ${formatNumber(source.speed)}` : ""}）が ${ratio.toFixed(1)} 倍食い違っています。at / duration はフレーム、source.in / out は秒です。取り違えていないか確かめてください（duration を秒で書いたなら ×fps = ${formatNumber(fps)}）。`,
                path: `${itemPath}.duration`,
              });
            }
          }
        }
        if (track.lane === "visual" && item.source?.kind === "media" && item.audio === false
          && (Object.hasOwn(item.source, "gain_db") || Object.hasOwn(item.source, "mute"))) {
          addFinding(findings, {
            severity: "warning",
            check: "v2.audio-embedded-unused",
            message: "source.gain_db / source.mute have no effect when the visual media item declares audio: false",
            path: `${itemPath}.source`,
          });
        }
        if (parent && Number.isInteger(item.at) && Number.isInteger(item.duration)
          && (item.at < 0 || item.at + item.duration > parent.duration)) {
          addFinding(findings, {
            severity: "warning",
            check: "v2.child-in-parent",
            message: `child interval [${item.at}, ${item.at + item.duration}) exceeds parent ${String(parent.id)} interval [0, ${parent.duration})`,
            path: itemPath,
            range: { start: item.at, end: item.at + item.duration },
          });
        }
        if (isRecord(item.motion)) {
          for (const seat of ["in", "out", "loop"]) {
            const entry = item.motion[seat];
            const presets = seat === "loop" ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS;
            if (isRecord(entry) && typeof entry.preset === "string" && !presets.has(entry.preset)) {
              addFinding(findings, {
                severity: "warning",
                check: "motion.unknown-preset",
                message: `unknown motion ${seat} preset: ${entry.preset}; ignored when rendering`,
                path: `${itemPath}.motion.${seat}`,
              });
            }
          }
          const inDuration = isRecord(item.motion.in) && Number.isInteger(item.motion.in.duration)
            ? item.motion.in.duration : 0;
          const outDuration = isRecord(item.motion.out) && Number.isInteger(item.motion.out.duration)
            ? item.motion.out.duration : 0;
          if (Number.isInteger(item.duration) && inDuration + outDuration > item.duration) {
            addFinding(findings, {
              severity: "error",
              check: "motion.in-out-exceeds",
              message: `motion in/out total ${inDuration + outDuration} exceeds item duration ${item.duration}`,
              path: `${itemPath}.motion`,
            });
          }
        }
        if (Object.hasOwn(item, "adjust")) {
          validateAdjust(item.adjust, findings, `${itemPath}.adjust`);
        }
        if (Array.isArray(item.items)) visit(item.items, item, `${itemPath}.items`);
      }
    };
    visit(track.items, null, `edit.json#tracks[${trackIndex}].items`);
  }

  const linkedTargets = new Map();
  for (const { item, path } of linkedAudioItems) {
    const target = itemTargets.get(item.link);
    if (!isNonEmptyString(item.link) || !target) {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target",
        message: `link does not reference an item in this edit: ${String(item.link)}`, path,
      });
    } else if (target.lane !== "visual" || target.item.source?.kind !== "media") {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target-kind",
        message: `link target must be a visual media item: ${item.link}`, path,
      });
    } else if (target.item.audio !== false) {
      addFinding(findings, {
        severity: "error", check: "v2.audio-link-target",
        message: `linked visual media item must declare audio: false: ${item.link}`, path,
      });
    }
    if (isNonEmptyString(item.link)) {
      if (linkedTargets.has(item.link)) {
        addFinding(findings, {
          severity: "error", check: "v2.audio-link-duplicate",
          message: `multiple audio items link to ${item.link} (first declared at ${linkedTargets.get(item.link)})`, path,
        });
      } else {
        linkedTargets.set(item.link, path);
      }
    }
  }

  const bgmItems = edit.tracks.flatMap((track, trackIndex) =>
    isRecord(track) && track.lane === "audio" && Array.isArray(track.items)
      ? track.items.flatMap((item, itemIndex) =>
        isRecord(item) && item.role === "bgm" ? [{
          id: item.id, trackIndex, itemIndex, start: item.at, end: item.at + item.duration,
          fadeIn: item.fade_in, fadeOut: item.fade_out,
        }] : [])
      : []
  );
  if (bgmItems.length > 1) {
    const describe = (item) => `${String(item.id)} [${item.start}, ${item.end})`;
    const overlaps = [];
    for (let i = 0; i < bgmItems.length; i += 1) {
      for (let j = i + 1; j < bgmItems.length; j += 1) {
        const start = Math.max(bgmItems[i].start, bgmItems[j].start);
        const end = Math.min(bgmItems[i].end, bgmItems[j].end);
        if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
          const [before, after] = bgmItems[i].start <= bgmItems[j].start
            ? [bgmItems[i], bgmItems[j]] : [bgmItems[j], bgmItems[i]];
          if (!(before.fadeOut > 0) && !(after.fadeIn > 0)) {
            overlaps.push({ label: `${String(before.id)} / ${String(after.id)} [${start}, ${end})`, frames: end - start });
          }
        }
      }
    }
    const exampleSeconds = overlaps.length && isPositiveNumber(fps)
      ? formatNumber(Number((overlaps[0].frames / fps).toFixed(2))) : null;
    if (overlaps.length) addFinding(findings, {
      severity: "warning", check: "v2.audio-bgm-multiple",
      message: `BGM ${bgmItems.map(describe).join('、')}。重なり: ${overlaps.map(overlap => overlap.label).join('、')}。重なった区間は両方の BGM が鳴ります。クロスフェードにするなら、前の item に fade_out（秒）、後の item に fade_in（秒）を付けてください${exampleSeconds !== null ? `（例: 重なり ${formatNumber(overlaps[0].frames)} フレーム = ${exampleSeconds} 秒なら "fade_out": ${exampleSeconds} / "fade_in": ${exampleSeconds}）` : ""}。意図しない重なりなら時間が重ならないように配置してください。（同じトラックの中では重ねられません。別の audio トラックに置いてください）`,
      path: "edit.json#tracks",
    });
  }

  for (const [trackIndex, track] of edit.tracks.entries()) {
    const trackPath = `edit.json#tracks[${trackIndex}]`;
    if (!isRecord(track)) {
      addFinding(findings, {
        severity: "error",
        check: "v2.track-content-exclusive",
        message: "track must be an object",
        path: trackPath,
      });
      continue;
    }
    registerId(trackIds, track.id, `${trackPath}.id`, "track");

    const hasItems = Object.hasOwn(track, "items");
    const hasContent = Object.hasOwn(track, "content");
    if (hasItems === hasContent) {
      addFinding(findings, {
        severity: "error",
        check: "v2.track-content-exclusive",
        message: "track must contain exactly one of items or content",
        path: trackPath,
      });
    }

    if (hasContent && track.lane !== "visual") {
      addFinding(findings, {
        severity: "error",
        check: "v2.lane-source",
        message: "captions content is only compatible with the visual lane",
        path: `${trackPath}.lane`,
      });
    }

    if (hasContent) {
      addFinding(findings, {
        severity: "warning",
        check: "v2.captions-content-deprecated",
        message: "tracks[].content は deprecated です。visual トラックの items[] に字幕の袋グループ item を置いてください（akari migrate で正規化できます）。",
        path: `${trackPath}.content`,
      });
    }

    if (!Array.isArray(track.items)) continue;
    if (track.items.length === 0) {
      addFinding(findings, {
        severity: "info",
        check: "v2.empty-track",
        message: "empty track will be removed by canonical save",
        path: trackPath,
      });
    }
    const intervals = [];
    let previousTimedItem = null;
    for (const [itemIndex, item] of track.items.entries()) {
      const itemPath = `${trackPath}.items[${itemIndex}]`;
      if (!isRecord(item)) continue;
      if (isFiniteNumber(item.at)) {
        if (previousTimedItem && item.at < previousTimedItem.at) {
          addFinding(findings, {
            severity: "warning",
            check: "timeline.items.order",
            message: `item ${String(item.id)} at array position ${itemIndex} has at=${formatNumber(item.at)}, before item ${String(previousTimedItem.id)} at position ${previousTimedItem.index} (at=${formatNumber(previousTimedItem.at)})`,
            path: itemPath,
          });
        }
        previousTimedItem = { id: item.id, index: itemIndex, at: item.at };
      }

      const kind = isRecord(item.source) ? item.source.kind : undefined;
      const compatible = isSourceCompatibleWithLane(track.lane, kind);
      if (!compatible) {
        addFinding(findings, {
          severity: "error",
          check: "v2.lane-source",
          message: `source kind ${String(kind)} is not compatible with lane ${String(track.lane)}`,
          path: `${itemPath}.source.kind`,
        });
      }

      if (Object.hasOwn(item, "mask")) {
        const maskPath = `${itemPath}.mask`;
        if (!isNonEmptyString(item.mask) || !sourceIds.has(item.mask)) {
          addFinding(findings, {
            severity: "error",
            check: "v2.mask-reference",
            message: `mask does not reference sources[].id: ${String(item.mask)}`,
            path: maskPath,
          });
        } else if (!isVideoSourcePath(sourcePaths.get(item.mask))
          && !(kind === "media" && isStillImageSourcePath(sourcePaths.get(item.source.src))
            && /\.png$/iu.test(String(sourcePaths.get(item.mask))))) {
          addFinding(findings, {
            severity: "error",
            check: "v2.mask-video",
            message: `${kind === "media" && isStillImageSourcePath(sourcePaths.get(item.source.src))
              ? "静止画のマスクは PNG または動画を指定してください"
              : "動画のマスクは動画ソースを指定してください"}: ${String(sourcePaths.get(item.mask))}`,
            path: maskPath,
          });
        }
      }

      if (kind === "html" && Object.hasOwn(item.source, "params")) {
        const params = item.source.params;
        const invalidEntry = isRecord(params)
          ? Object.entries(params).find(([, value]) => typeof value !== "string")
          : ["params", params];
        if (invalidEntry) {
          addFinding(findings, {
            severity: "error",
            check: "v2.html-params",
            message: "HTML source params must be an object whose values are strings",
            path: `${itemPath}.source.params${invalidEntry[0] === "params" ? "" : `.${invalidEntry[0]}`}`,
          });
        }
      }

      if (track.lane === "audio") {
        const role = item.role ?? "sfx";
        if (Object.hasOwn(item, "gain_db")
          && (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)) {
          addFinding(findings, {
            severity: "error",
            check: `audio.${role}.gain-db`,
            message: "gain_db must be a finite number within [-60, 12]",
            path: `${itemPath}.gain_db`,
          });
        }
        validateAudioEnvelopeDeclaration(item, role, item.duration, findings, itemPath, {
          v2: true,
          timeScale: edit.output?.fps,
        });
        if (isRecord(item.source)) {
          validateAudioClipFxDeclaration(item.source, role, findings, itemPath, {
            sourcePath: `${itemPath}.source`,
          });
        }
        validateAudioClipFxDeclaration(item, role, findings, itemPath);
        for (const [field, bgmField] of [["fade_in", "fadeIn"], ["fade_out", "fadeOut"]]) {
          if (!Object.hasOwn(item, field) || (isFiniteNumber(item[field]) && item[field] >= 0)) continue;
          addFinding(findings, {
            severity: "error",
            check: role === "bgm" ? `audio.bgm.${bgmField}` : `audio.sfx.${field}`,
            message: `${field} must be a non-negative finite number`,
            path: `${itemPath}.${field}`,
          });
        }
        if (isRecord(item.source)) {
          if (role === "narration") {
            for (const field of ["in", "out"]) {
              if (!Object.hasOwn(item.source, field)
                || (isFiniteNumber(item.source[field]) && item.source[field] >= 0)) continue;
              addFinding(findings, {
                severity: "error",
                check: "audio.narration.trim",
                message: `${field} must be a non-negative finite number`,
                path: `${itemPath}.source.${field}`,
              });
            }
          }
          if (isFiniteNumber(item.source.in)
            && item.source.in >= 0
            && isFiniteNumber(item.source.out)
            && item.source.out >= 0
            && item.source.out <= item.source.in) {
            addFinding(findings, {
              severity: "error",
              check: role === "narration" ? "audio.narration.trim" : "audio.sfx.in-out",
              message: `${role === "narration" ? "narration" : "sfx"} must satisfy in < out when both are present`,
              path: `${itemPath}.source`,
              range: { start: item.source.in, end: item.source.out },
            });
          }
        }
      }

      // Visual items with duration: 0 represent nothing renderable and remain invalid. Audio
      // items deliberately use 0 as the unresolved-material-duration sentinel when a legacy
      // declaration omits an explicit out point; render-cut resolves that duration from media.
      if (track.lane !== "audio" && Number.isInteger(item.duration) && item.duration === 0) {
        addFinding(findings, {
          severity: "error",
          check: "v2.item-duration",
          message: "item duration must be a positive integer (0 represents nothing on the timeline)",
          path: `${itemPath}.duration`,
        });
      }

      if (Number.isInteger(item.at) && item.at >= 0 && Number.isInteger(item.duration) && item.duration >= 0) {
        const transitionSeconds = isRecord(item.source?.transition_out)
          && isPositiveNumber(item.source.transition_out.duration)
          ? item.source.transition_out.duration : 0;
        intervals.push({
          index: itemIndex,
          start: item.at,
          end: item.at + item.duration,
          transitionFrames: Math.round(transitionSeconds * (edit.output?.fps ?? 0)),
        });
      }
    }

    intervals.sort((left, right) => left.start - right.start || left.index - right.index);
    let furthest = null;
    for (const interval of intervals) {
      const overlap = furthest ? furthest.end - interval.start : 0;
      if (furthest && overlap > 0 && interval.end > interval.start
        && overlap > furthest.transitionFrames) {
        addFinding(findings, {
          severity: "error",
          check: "v2.track-no-overlap",
          message: `item overlaps ${furthest.index} on the same track`,
          path: `${trackPath}.items[${interval.index}]`,
          range: { start: interval.start, end: interval.end },
        });
      }
      if (!furthest || interval.end > furthest.end) furthest = interval;
    }
  }
}

function validateV2ItemAnchors(edit, captionsState, findings) {
  const captions = toAnchorCaptions(captionsState.value);
  const captionById = new Map(captions.map(caption => [caption.id, caption]));
  const entries = [];
  const visit = (items, parentPath) => {
    if (!Array.isArray(items)) return;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const path = `${parentPath}[${index}]`;
      if (Object.hasOwn(item, "anchor")) entries.push({ item, path });
      visit(item.items, `${path}.items`);
    }
  };
  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    if (isRecord(track)) visit(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  for (const { item, path } of entries) {
    const kind = isRecord(item.source) ? item.source.kind : undefined;
    if (kind === "captions" || kind === "caption") {
      addFinding(findings, {
        severity: "error",
        check: "v2.item-anchor-kind",
        message: `source kind ${String(kind)} cannot declare anchor`,
        path: `${path}.anchor`,
      });
      continue;
    }
    const anchor = isRecord(item.anchor) ? item.anchor : {};
    const caption = captionById.get(anchor.caption);
    if (!caption) {
      addFinding(findings, {
        severity: captionsState.exists ? "error" : "warning",
        check: "v2.item-anchor-ref",
        message: captionsState.exists
          ? `anchor.caption does not reference captions.json: ${String(anchor.caption)}`
          : `captions.json is absent; anchor.caption cannot be resolved: ${String(anchor.caption)}`,
        path: `${path}.anchor.caption`,
      });
      continue;
    }
    if (Object.hasOwn(anchor, "range")) {
      const range = isRecord(anchor.range) ? anchor.range : {};
      if (!isFiniteNumber(range.start) || !isFiniteNumber(range.end)
        || range.start < caption.start - EPSILON
        || range.end > caption.end + EPSILON
        || range.end <= range.start) {
        addFinding(findings, {
          severity: "error",
          check: "v2.item-anchor-range",
          message: `anchor range [${String(range.start)}, ${String(range.end)}] must satisfy ${caption.start} <= start < end <= ${caption.end}`,
          path: `${path}.anchor.range`,
        });
      }
    }
  }

  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    const inspect = (items, parentPath) => {
      for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
        if (!isRecord(item)) continue;
        const path = `${parentPath}[${index}]`;
        if (isRecord(item.anchor) && isRecord(item.anchor.attached_by)
          && item.anchor.attached_by.caption !== item.anchor.caption) {
          addFinding(findings, { severity: 'error', check: 'v2.item-attached-by-anchor',
            message: 'anchor.attached_by.caption must match anchor.caption', path: `${path}.anchor.attached_by.caption` });
        }
        inspect(item.items, `${path}.items`);
      }
    };
    if (isRecord(track)) inspect(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  if (entries.length === 0) return;
  const resolved = resolveItemAnchors(edit, captions);
  const pathById = new Map(entries.map(entry => [entry.item.id, entry.path]));
  for (const change of resolved.changes) {
    addFinding(findings, {
      severity: "warning",
      check: "v2.item-anchor-stale",
      message: `anchor resolves to at=${change.after.at}, duration=${change.after.duration}; cached at=${change.before.at}, duration=${change.before.duration}`,
      path: `${pathById.get(change.id) ?? "edit.json#tracks"}.anchor`,
    });
  }
  for (const warning of resolved.warnings) {
    if (warning.reason !== "removed-range" && warning.reason !== "no-source-segments") continue;
    addFinding(findings, {
      severity: "warning",
      check: "v2.item-anchor-unresolvable",
      message: `anchor interval is not visible on the output timeline (${warning.reason})`,
      path: `${pathById.get(warning.id) ?? "edit.json#tracks"}.anchor`,
    });
  }
}

async function validateV2ObjectTreeFiles(edit, findings, paths) {
  const entries = [];
  const visit = (items, itemPath) => {
    if (!Array.isArray(items)) return;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const path = `${itemPath}[${index}]`;
      entries.push({ item, path });
      visit(item.items, `${path}.items`);
    }
  };
  for (const [trackIndex, track] of (Array.isArray(edit.tracks) ? edit.tracks : []).entries()) {
    if (isRecord(track)) visit(track.items, `edit.json#tracks[${trackIndex}].items`);
  }

  const referencedMotion = new Set();
  for (const { item, path: itemPath } of entries) {
    if (item.source?.kind === "telop" && item.source.baked === undefined) {
      addFinding(findings, {
        severity: "error",
        check: "telop.retired",
        message: "テロップ（ATF）の描画は退役しました。HTML 素材版のテロップに差し替えてください（Lab で配布）。すでに焼いた baked を持つ項目はそのまま再生できます。",
        path: `${itemPath}.source`,
      });
    }
    if (isRecord(item.keyframes) && isNonEmptyString(item.keyframes.path)) {
      referencedMotion.add(item.keyframes.path);
      const filePath = resolve(paths.projectRoot, item.keyframes.path);
      let bag;
      try {
        bag = JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        addFinding(findings, {
          severity: "error",
          check: "v2.keyframes-ref",
          message: `keyframes bag does not exist or is not valid JSON: ${item.keyframes.path}`,
          path: `${itemPath}.keyframes`,
        });
        continue;
      }
      const points = isRecord(bag.items) ? bag.items[item.id] : undefined;
      validateAnimatorRefs(item, points, findings, `${itemPath}.keyframes`);
      if (!Array.isArray(points) || points.length !== item.keyframes.count) {
        addFinding(findings, {
          severity: "error",
          check: "v2.keyframes-ref",
          message: `keyframes count ${String(item.keyframes.count)} does not match bag item count ${Array.isArray(points) ? points.length : "missing"}`,
          path: `${itemPath}.keyframes`,
        });
      }
    }
  }

  let captionsIds;
  const loadCaptionsIds = async () => {
    if (captionsIds !== undefined) return captionsIds;
    captionsIds = new Set();
    try {
      const parsed = JSON.parse(await readFile(paths.captionsPath, "utf8"));
      const rows = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.rows) ? parsed.rows
          : Array.isArray(parsed?.captions) ? parsed.captions : [];
      for (const row of rows) if (isRecord(row) && isNonEmptyString(row.id)) captionsIds.add(row.id);
    } catch {
      // Missing captions.json is reported by the existing captions checks. part-ref remains a warning.
    }
    return captionsIds;
  };

  for (const { item, path: itemPath } of entries) {
    if (!isRecord(item.source)) continue;
    const source = item.source;
    if (source.kind === "html" && (isNonEmptyString(source.part) || Array.isArray(source.exclude))) {
      let html = "";
      try {
        html = await readFile(resolve(paths.projectRoot, source.path), "utf8");
      } catch {
        // The existing overlay file check reports the missing file; every requested part is absent here.
      }
      const requested = [
        ...(isNonEmptyString(source.part) ? [source.part] : []),
        ...(Array.isArray(source.exclude) ? source.exclude.filter(isNonEmptyString) : []),
      ];
      for (const id of requested) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`data-akari-part="${escaped}"`, "u").test(html)) continue;
        addFinding(findings, {
          severity: "warning",
          check: "v2.part-ref",
          message: `HTML part id was not found at string level: ${id}`,
          path: `${itemPath}.source`,
        });
      }
    }
    if (source.kind === "captions" || source.kind === "caption") {
      const ids = await loadCaptionsIds();
      const requested = source.kind === "caption"
        ? [source.id]
        : Array.isArray(source.exclude) ? source.exclude.filter(isNonEmptyString) : [];
      for (const id of requested) {
        if (ids.has(id)) continue;
        addFinding(findings, {
          severity: "warning",
          check: "v2.part-ref",
          message: `captions row id was not found: ${String(id)}`,
          path: `${itemPath}.source`,
        });
      }
    }
  }

  const motionDirectory = join(paths.projectRoot, "motion");
  let motionFiles = [];
  try {
    motionFiles = (await readdir(motionDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => `motion/${entry.name}`);
  } catch {
    motionFiles = [];
  }
  for (const motionPath of motionFiles) {
    if (referencedMotion.has(motionPath)) continue;
    addFinding(findings, {
      severity: "warning",
      check: "motion.orphan",
      message: `motion bag is not referenced by edit.json: ${motionPath}`,
      path: motionPath,
    });
  }
}

function isVideoSourcePath(value) {
  return isNonEmptyString(value)
    && /\.(?:mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ogv)(?:[?#].*)?$/iu.test(value);
}

function validateTransitionOut(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.structure", message: "transition_out must be an object", path });
    return;
  }
  if (!TRANSITION_TYPE_IDS.includes(value.type)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.type", message: `type must be ${TRANSITION_TYPE_IDS.join("/")}`, path });
  }
  if (!isPositiveNumber(value.duration)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.duration", message: "duration must be a positive number", path });
  }
}

function validateAudioMaster(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "audio.master.structure", message: "master must be an object", path });
    return;
  }
  if (Object.hasOwn(value, "denoise") && !["off", "std", "strong"].includes(value.denoise)) {
    addFinding(findings, { severity: "error", check: "audio.master.denoise", message: "denoise must be off/std/strong", path });
  }
  if (
    Object.hasOwn(value, "loudnorm") &&
    (!isFiniteNumber(value.loudnorm) || value.loudnorm < -70 || value.loudnorm > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.loudnorm", message: "loudnorm must be a finite number within [-70, 0]", path });
  }
  if (
    Object.hasOwn(value, "true_peak_dbtp") &&
    (!isFiniteNumber(value.true_peak_dbtp) || value.true_peak_dbtp < -9 || value.true_peak_dbtp > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.true-peak", message: "true_peak_dbtp must be a finite number within [-9, 0]", path });
  }
}

function validateOutputEncoding(value, findings, path) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "output.encoding.structure", message: "encoding must be an object", path });
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "quality" && key !== "encoder") addFinding(findings, { severity: "error", check: "output.encoding.structure", message: `${key} is not defined by output.encoding`, path });
  }
  if (Object.hasOwn(value, "quality") && !["master", "high", "standard", "light"].includes(value.quality)) {
    addFinding(findings, { severity: "error", check: "output.encoding.quality", message: "quality must be master/high/standard/light", path });
  }
  if (Object.hasOwn(value, "encoder") && !["auto", "videotoolbox", "x264"].includes(value.encoder)) {
    addFinding(findings, { severity: "error", check: "output.encoding.encoder", message: "encoder must be auto/videotoolbox/x264", path });
  }
}

// at 省略 = 同一 track 内で直前カットの直後（既存ファイルは全カット track 省略=0・
// at 省略なので、この既定は従来のギャップレス連結と完全に同値 = 後方互換）
function computeCutTrackSegments(cuts) {
  if (!Array.isArray(cuts)) return [];
  const cursorByTrack = new Map();
  const segments = [];
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out) || cut.out <= cut.in) {
      continue;
    }
    const hasValidTrack = Object.hasOwn(cut, "track") && Number.isInteger(cut.track) && cut.track >= 0;
    const track = hasValidTrack ? cut.track : 0;
    const duration = segmentDuration(cut);
    const cursor = cursorByTrack.get(track) ?? 0;
    const hasValidAt = Object.hasOwn(cut, "at") && isFiniteNumber(cut.at) && cut.at >= 0;
    const start = hasValidAt ? cut.at : cursor;
    const end = start + duration;
    cursorByTrack.set(track, end);
    segments.push({ index, track, start, end });
  }
  return segments;
}

function findTrackOverlaps(segments) {
  const byTrack = new Map();
  for (const segment of segments) {
    if (!byTrack.has(segment.track)) byTrack.set(segment.track, []);
    byTrack.get(segment.track).push(segment);
  }
  const overlaps = [];
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end - EPSILON) {
        overlaps.push(list[i]);
      }
    }
  }
  return overlaps;
}

// P0 2026-08-21 render-path-unification (MAJOR-3 fix, Codex review): render-cut now auto-clamps
// a declared transition_out.duration down to whatever overlap an explicit `at` actually provides
// (packages/render-cut/src/cut-timeline.mjs's effectiveTransitionDurations) whenever that overlap
// is real (positive) but shorter than declared, rendering a genuinely shorter dissolve instead of
// silently hard-cutting and dropping frames -- so this check must accept that same range as a
// valid, declared transition (not only an exact duration match), or a project render-cut can now
// render correctly would still fail lint. Still rejects zero/negative overlap (a genuine gap --
// no transition is physically possible) and overlap greater than declared (an unrelated shape
// render-cut does not auto-adjust for -- see effectiveTransitionDurations' own comment).
function isDeclaredTransitionOverlap(cuts, segments, current, fps) {
  const previous = segments
    .filter(segment => segment.track === current.track && segment.index < current.index)
    .sort((left, right) => right.index - left.index)[0];
  if (!previous) return false;
  const duration = cuts?.[previous.index]?.transition_out?.duration;
  if (!isPositiveNumber(duration)) return false;
  return areCutsAdjacent(
    { tlEnd: previous.end, transitionOut: { duration } },
    { tlStart: current.start },
    fps,
  );
}

function validateCutTrackFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (Object.hasOwn(cut, "at") && (!isFiniteNumber(cut.at) || cut.at < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.at",
        message: "at must be a non-negative finite number when present",
        path: `${path}.at`,
      });
    }
    if (Object.hasOwn(cut, "track") && (!Number.isInteger(cut.track) || cut.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.track",
        message: "cut track must be a non-negative integer when present",
        path: `${path}.track`,
      });
    }
  }
}

function validateCutTransformFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (
      Object.hasOwn(cut, "opacity") &&
      (!isFiniteNumber(cut.opacity) || cut.opacity < 0 || cut.opacity > 1)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.opacity",
        message: "opacity must be a finite number between 0 and 1 when present",
        path: `${path}.opacity`,
      });
    }
    if (!Object.hasOwn(cut, "transform")) continue;
    if (!isRecord(cut.transform)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform must be an object when present",
        path: `${path}.transform`,
      });
      continue;
    }
    const allowedKeys = new Set(["x", "y", "scale", "rotate"]);
    for (const key of Object.keys(cut.transform)) {
      if (!allowedKeys.has(key)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform has an unknown key: ${key}`,
          path: `${path}.transform`,
        });
      }
    }
    for (const field of ["x", "y", "rotate"]) {
      if (Object.hasOwn(cut.transform, field) && !isFiniteNumber(cut.transform[field])) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform.${field} must be a finite number when present`,
          path: `${path}.transform.${field}`,
        });
      }
    }
    if (Object.hasOwn(cut.transform, "scale") && !isPositiveNumber(cut.transform.scale)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform.scale must be a positive number when present",
        path: `${path}.transform.scale`,
      });
    }
  }
}

// 裁定3〜5（in/out 意味論・freeze/speed 警告・v0 空 cuts 拒否）。source が静止画のときだけ発火する。
function validateStillImageCuts(edit, findings) {
  if (!isRecord(edit)) return;
  const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];

  const imageSourceIds = new Set(
    (Array.isArray(edit.sources) ? edit.sources : [])
      .filter((source) => isRecord(source) && isStillImageSourcePath(source.path))
      .map((source) => source.id),
  );
  if (imageSourceIds.size === 0) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut) || !imageSourceIds.has(cut.src)) continue;
    validateStillImageCutFields(cut, index, findings);
  }
}

function validateStillImageCutFields(cut, index, findings) {
  if (!isRecord(cut)) return;
  const path = `edit.json#cuts[${index}]`;
  if (isFiniteNumber(cut.in) && Math.abs(cut.in) > EPSILON) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-in",
      message:
        "cut.in has no source to seek into for a still image -- only out - in (the display duration) is used "
          + "by render; 0 is recommended for cut.in here",
      path: `${path}.in`,
    });
  }
  if (Object.hasOwn(cut, "freeze") && isRecord(cut.freeze)) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-freeze",
      message:
        "freeze on a still image source is a no-op visually (the source frame never changes) -- it only adds "
          + "hold time; extending out achieves the same result more directly",
      path: `${path}.freeze`,
    });
  }
  if (
    Object.hasOwn(cut, "speed") &&
    isPositiveNumber(cut.speed) &&
    Math.abs(cut.speed - 1) > EPSILON
  ) {
    addFinding(findings, {
      severity: "warning",
      check: "cuts.still-image-speed",
      message:
        "speed on a still image source has no visual effect (the source frame never changes) -- it only "
          + "rescales the display duration",
      path: `${path}.speed`,
    });
  }
}

function validateOutputAxisDurationMax(outputs, cutSegments, findings) {
  if (!Array.isArray(outputs) || cutSegments.length === 0) return;
  const maxEnd = cutSegments.reduce((max, segment) => Math.max(max, segment.end), 0);
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) continue;
    if (maxEnd > maximum + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "outputs.duration-max-gaps",
        message: `output axis duration ${formatNumber(maxEnd)}s (accounting for cuts[].at gaps/tracks) exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
      });
    }
  }
}

function validateLayerTracks(layers, findings) {
  if (!Array.isArray(layers)) return;
  const segments = [];
  layers.forEach((layer, index) => {
    if (!isRecord(layer)) return;
    const path = `edit.json#layers[${index}]`;
    if (Object.hasOwn(layer, "track") && (!Number.isInteger(layer.track) || layer.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "layers.track",
        message: "layer track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(layer.t) || !isPositiveNumber(layer.duration)) return;
    const hasValidTrack = Object.hasOwn(layer, "track") && Number.isInteger(layer.track) && layer.track >= 0;
    const track = hasValidTrack ? layer.track : 0;
    segments.push({ index, track, start: layer.t, end: layer.t + layer.duration });
  });
  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "warning",
      check: "layers.track-overlap",
      message: `layer overlaps another layer on track ${segment.track} in the output axis`,
      path: `edit.json#layers[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
}

// sfx には duration が無い（瞬間マーカー）ため、「重なり」は同一 track かつ
// 実質同一 t（EPSILON 以内）に退化させる。
function validateSfxTracks(sfx, findings) {
  if (!Array.isArray(sfx)) return;
  const pointsByTrack = new Map();
  sfx.forEach((item, index) => {
    if (!isRecord(item)) return;
    const path = `edit.json#audio.sfx[${index}]`;
    if (Object.hasOwn(item, "track") && (!Number.isInteger(item.track) || item.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.track",
        message: "sfx track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(item.t)) return;
    const hasValidTrack = Object.hasOwn(item, "track") && Number.isInteger(item.track) && item.track >= 0;
    const track = hasValidTrack ? item.track : 0;
    if (!pointsByTrack.has(track)) pointsByTrack.set(track, []);
    pointsByTrack.get(track).push({ index, t: item.t, path: isNonEmptyString(item.path) ? item.path : undefined, track });
  });
  for (const list of pointsByTrack.values()) {
    list.sort((a, b) => a.t - b.t);
    let groupStart = 0;
    for (let i = 1; i < list.length; i += 1) {
      if (Math.abs(list[i].t - list[i - 1].t) <= EPSILON) {
        const current = list[i];
        const samePath = current.path !== undefined
          && list.slice(groupStart, i).some(previous => previous.path !== undefined && previous.path === current.path);
        addFinding(findings, {
          severity: samePath ? "warning" : "info",
          check: "audio.sfx.track-overlap",
          message: samePath
            ? `効果音 audio.sfx[${current.index}] が同じ track ${current.track}・同じ時刻 ${formatNumber(current.t)} 秒に同じ素材 ${current.path} で置かれています（二重置きの可能性）。意図した重ねなら track を分けてください（書き出しのミックスは track を見ずに全部鳴らしますが、NLE 書き出しは track を NLE のトラック単位にするため同じトラックに重なります）。`
            : `効果音 audio.sfx[${current.index}] が同じ track ${current.track}・同じ時刻 ${formatNumber(current.t)} 秒に別素材と重なっています。書き出しのミックスは track を見ずに両方鳴らします。重ねるつもりなら track を分けてください（NLE 書き出しは track を NLE のトラック単位にするため、同じトラックに重なります）。`,
          path: `edit.json#audio.sfx[${current.index}]`,
          range: { start: current.t, end: current.t },
        });
      } else {
        groupStart = i;
      }
    }
  }
}

function validateTimelineTracks(edit, findings, projectedAudioTracks = null) {
  const timeline = edit?.timeline;
  if (timeline === undefined || timeline === null) return;
  if (!isRecord(timeline)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline must be an object",
      path: "edit.json#timeline",
    });
    return;
  }
  if (!Array.isArray(timeline.tracks)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline.tracks must be an array",
      path: "edit.json#timeline.tracks",
    });
    return;
  }

  const audioTracks = projectedAudioTracks ?? collectActualTrackNumbers(edit?.audio?.sfx);
  if (projectedAudioTracks === null
    && (isRecord(edit?.audio?.bgm) || (Array.isArray(edit?.audio?.narration) && edit.audio.narration.length > 0))) {
    audioTracks.add(0);
  }
  const actualTracks = new Map([
    ["cuts", collectActualTrackNumbers(edit?.cuts)],
    ["layers", collectActualTrackNumbers(edit?.layers)],
    ["overlays", collectActualTrackNumbers(edit?.overlays)],
    ["audio", audioTracks],
  ]);
  const allowedKinds = new Set(["cuts", "layers", "overlays", "captions", "audio"]);
  const ids = new Set();
  const declarations = new Set();
  const singletonCounts = new Map();

  for (const [index, item] of timeline.tracks.entries()) {
    const path = `edit.json#timeline.tracks[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.structure",
        message: "timeline track must be an object",
        path,
      });
      continue;
    }

    if (!isNonEmptyString(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: "timeline track id must be a non-empty string",
        path: `${path}.id`,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: `duplicate timeline track id: ${item.id}`,
        path: `${path}.id`,
      });
    } else {
      ids.add(item.id);
    }

    if (!allowedKinds.has(item.kind)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.kind",
        message: "timeline track kind must be cuts/layers/overlays/captions/audio",
        path: `${path}.kind`,
      });
      continue;
    }

    const hasRef = Object.hasOwn(item, "ref");
    const validRef = !hasRef || (Number.isInteger(item.ref) && item.ref >= 0);
    if (!validRef) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.ref",
        message: "timeline track ref must be a non-negative integer when present",
        path: `${path}.ref`,
      });
    }
    if (Object.hasOwn(item, "label") && typeof item.label !== "string") {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.label",
        message: "timeline track label must be a string when present",
        path: `${path}.label`,
      });
    }
    for (const field of ["muted", "hidden", "locked"]) {
      if (Object.hasOwn(item, field) && typeof item[field] !== "boolean") {
        addFinding(findings, {
          severity: "error",
          check: `timeline.tracks.${field}`,
          message: `timeline track ${field} must be a boolean when present`,
          path: `${path}.${field}`,
        });
      }
    }

    // audio は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化された。宣言ごとの ref が
    // 異なる限り複数宣言は正常な運用のため、singleton warning の対象からは除外する
    // （captions は引き続き単一トラック運用のため維持）。
    if (item.kind === "captions") {
      const count = (singletonCounts.get(item.kind) ?? 0) + 1;
      singletonCounts.set(item.kind, count);
      if (count > 1) {
        addFinding(findings, {
          severity: "warning",
          check: "timeline.tracks.singleton",
          message: `${item.kind} timeline track is declared more than once`,
          path,
        });
      }
    }

    if (!validRef || item.kind === "captions") continue;
    // audio の ref は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化されたため、
    // 0 固定を要求しない（非 0 ref も正当な宣言として declarations に加える）。
    const ref = item.kind === "audio" && !hasRef ? 0 : item.ref;
    if (ref === undefined) continue;
    declarations.add(`${item.kind}:${ref}`);
  }
  // ここには以前 `timeline.tracks.ref-missing`（宣言された段の ref が実データのどこにも
  // 現れなければ警告）があったが、2026-08-20 に撤去した。v2 では timeline.tracks[] の各段が
  // internal-model.ts の projectLegacyEdit を通じてそのまま legacy 射影され、ref は宣言順に
  // 毎回生成し直される連番なので、「宣言はあるが実データに現れない ref」は「段の中身が 0 個」
  // としか等価にならない。空の段は自動 prune せず残すのが正本（10番裁定 E）なので、この
  // チェックは空の段を持つ v2 プロジェクトのたびに必ず誤検知していた。v0/v1 は本体から既に
  // 除かれており（9番）、「(kind, ref) の参照」という v0/v1 由来の概念自体が v2 には無いため
  // 部分修正ではなく撤去する。撤去の証跡は edit-lint.test.mjs の
  // "空の段を持つ v2 プロジェクトは findings 0" で固定してある。

  for (const [kind, tracks] of actualTracks) {
    for (const ref of tracks) {
      if (declarations.has(`${kind}:${ref}`)) continue;
      addFinding(findings, {
        severity: "warning",
        check: "timeline.tracks.declaration-missing",
        message: `${kind} edit data uses track ${ref}, but timeline.tracks has no matching declaration`,
        path: `edit.json#${kind === "audio" ? "audio.sfx" : kind}`,
      });
    }
  }
}

// task 2026-08-07-track-transition-lint-guard (following up on task 2026-08-07-render-frame-accounting's
// track-compose.mjs sweep, task #14): gap-aware track compositing (a non-default timeline.tracks
// declaration, which routes v1 through buildTrackStackPlan/resolveCutTrackRanges instead of the
// plain sequential render path) does not compose with cuts[].transition_out. resolveCutTrackRanges's
// gap-aware placement is built on resolveCutSegments/computeVideoRuns, which assume same-track
// adjacent cuts occupy separate, non-overlapping windows -- an xfade's whole point is to blend two
// cuts into one overlapping region, so that assumption mechanically splits one continuous
// dissolve into two separately-windowed composites. Verified with a real render (2026-08-07,
// v1, a "cuts" track holding lime -> [0.5s dissolve] -> magenta, composited via an explicit
// non-default timeline.tracks order): the second cut's window pointed 0.5s past where the
// actually-xfade-shrunk clip's real content lives, so playback showed the base track's plain
// background leaking through for the tail 0.5s where the dissolved clip should still have been
// visible. Properly supporting this would mean teaching resolveCutSegments/computeVideoRuns
// about overlap, and those are shared by v0's own at/track placement and layers placement --
// too wide a blast radius to take on speculatively, especially with no evidence anyone needs the
// combination. Reject it instead: it fails loudly and specifically, rather than rendering a
// broken video with a phantom black flash that's very hard to trace back to its cause.
export function validateTrackTransitionOutCompatibility(edit, findings) {
  for (const { cutIndex, trackRef } of findUnsupportedDeclaredTrackTransitions(
    edit?.cuts,
    edit?.timeline?.tracks,
  )) {
    addFinding(findings, {
      severity: "error",
      check: "cuts.track-transition-unsupported",
      message:
        `映像トラック ${trackRef} の transition_out は、PiP または複数トラックを合成する方式では書き出せません。`
        + `トランジションを削除するか、映像を単一の cuts トラックへ戻してください。`,
      path: `edit.json#cuts[${cutIndex}]`,
    });
  }
}

function collectActualTrackNumbers(items) {
  const tracks = new Set();
  if (!Array.isArray(items)) return tracks;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (!Object.hasOwn(item, "track")) {
      tracks.add(0);
    } else if (Number.isInteger(item.track) && item.track >= 0) {
      tracks.add(item.track);
    }
  }
  return tracks;
}

function validateCuts(cuts, findings, paths, sourceIds) {
  if (!Array.isArray(cuts)) return null;
  let valid = true;
  let timeline = 0;

  for (const [index, cut] of cuts.entries()) {
    const path = `edit.json#cuts[${index}]`;
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut in/out must be finite numbers",
        path,
      });
      valid = false;
      continue;
    }
    if (cut.in < 0 || cut.out <= cut.in) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut must satisfy 0 <= in < out",
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    } else {
      timeline += segmentDuration(cut);
    }
    if (!isNonEmptyString(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src",
          message: "version 1 cut src must be a non-empty string",
          path,
        });
        valid = false;
    } else if (!sourceIds.has(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src-reference",
          message: `cut src does not reference sources[].id: ${cut.src}`,
          path,
        });
        valid = false;
    }
    if (Object.hasOwn(cut, "speed") && !isPositiveNumber(cut.speed)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.speed",
        message: "speed must be a positive number",
        path,
      });
      valid = false;
    }
    validateTransitionOut(cut.transition_out, findings, `${path}.transition_out`);
  }

  if (cuts.length === 0) return 0;
  return valid ? timeline : null;
}

function validateDurationMaximum(outputs, timeline, findings) {
  if (outputs === undefined) return;
  if (!Array.isArray(outputs)) {
    addFinding(findings, {
      severity: "error",
      check: "outputs.duration-max",
      message: "outputs must be an array when present",
      path: "edit.json#outputs",
    });
    return;
  }
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: "duration_max must be a positive number",
        path: `edit.json#outputs[${index}].duration_max`,
      });
    } else if (timeline !== null && timeline > maximum + EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: `timeline duration ${formatNumber(timeline)}s exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
        range: { start: 0, end: timeline },
      });
    }
  }
}

async function validateOverlays(overlays, timeline, findings, paths) {
  if (!Array.isArray(overlays)) return;
  const ids = new Set();
  for (const [index, overlay] of overlays.entries()) {
    const itemPath = `edit.json#overlays[${index}]`;
    if (!isRecord(overlay)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.structure",
        message: "overlay must be an object",
        path: itemPath,
      });
      continue;
    }
    if (!isNonEmptyString(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: "overlay id must be a non-empty string",
        path: itemPath,
      });
    } else if (ids.has(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: `duplicate overlay id: ${overlay.id}`,
        path: itemPath,
      });
    } else {
      ids.add(overlay.id);
    }

    if (
      Object.hasOwn(overlay, "track") &&
      (!Number.isInteger(overlay.track) || overlay.track < 0)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.track",
        message: "overlay track must be a non-negative integer when present",
        path: `${itemPath}.track`,
      });
    }

    if (!isFiniteNumber(overlay.start) || overlay.start < 0) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay start must be a non-negative finite number",
        path: itemPath,
      });
    }
    if (!isPositiveNumber(overlay.duration)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay duration must be greater than zero",
        path: itemPath,
      });
    }
    if (
      timeline !== null &&
      isFiniteNumber(overlay.start) &&
      isPositiveNumber(overlay.duration) &&
      overlay.start + overlay.duration > timeline + EPSILON
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: `overlay ends after timeline duration ${formatNumber(timeline)}s`,
        path: itemPath,
        range: { start: overlay.start, end: overlay.start + overlay.duration },
      });
    }
    if (!isNonEmptyString(overlay.html)) continue;
    const htmlBinding = resolveReferenceBinding(paths.editPath, overlay.html, paths);
    const htmlPath = htmlBinding.path;
    const isHtmlFile = await isRegularFile(htmlPath);
    // overlay.html は file 参照（相対パス）とインライン HTML の両方をとりうる。参照でなければ
    // フィールドの値そのものを断片本文として扱う（inspectHtmlFragment 以降のルート要素検証は
    // 既存どおり file 参照限定のまま — 挙動変更を避ける）。
    const html = isHtmlFile ? await readRequiredText(htmlPath, overlay.html) : overlay.html;
    validateOverlayReservedCssVarReferences(
      html,
      isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      findings,
    );
    validateOverlayMotionRules(
      html,
      isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      findings,
    );
    for (const finding of validateWorldSceneDeclaration(html, await readFile(join(paths.projectRoot, "planning/world-map.json"), "utf8").catch(error => error?.code === "ENOENT" ? null : Promise.reject(error)), isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`)) addFinding(findings, finding);
    validateThreeCanvas(html, isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`, findings);
    if (!isHtmlFile) continue;

    validateOverlayFragmentAssets(html, overlay, paths, findings);
    runOverlayFragmentFontGlyphCheck(html, overlay, paths, findings);
    const fragment = inspectHtmlFragment(html);
    if (fragment.rootCount !== 1 || fragment.hasTopLevelText || fragment.unbalanced) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.html-root",
        message: "overlay HTML must contain exactly one balanced root element",
        path: relativePath(paths.projectRoot, htmlPath),
      });
      continue;
    }
    // 共有ライブラリ参照（.akari/asset-references.json 経由で原本を読む）の断片は、ライブラリが
    // data-start="0" data-duration="<素材の長さ>" で配っていて、プロジェクト側からは書き換えられない。
    // 置いた時刻・長さの写しを作る取り込み（placedFragmentCopy）も参照では走らないため、ここで
    // 検査すると置いた時点で必ず不一致になり書き出しが止まる。ランタイムは edit.json から作る
    // .akari-overlay-container の値だけを使うので、原本ルートの値は検査しない。
    const libraryFragment = htmlBinding.scope === "library";
    if (
      !libraryFragment
      && (Object.hasOwn(fragment.rootAttributes, "data-start")
        || Object.hasOwn(fragment.rootAttributes, "data-duration"))
    ) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.root-data-attributes",
        message:
          "overlay fragment root must not declare data-start or data-duration; edit.json is the "
          + "source of truth, and animation-delay inside the fragment uses local seconds from clip "
          + "start 0, not absolute timeline seconds",
        path: relativePath(paths.projectRoot, htmlPath),
      });
    }
    // テキスト分割断片の CSS animation は [data-akari-active] ゲートの中で宣言する
    // （skills/overlay-authoring/telop.md「テキスト分割と stagger 規約」）。
    // getAnimations() のコストはドキュメント全体の animation 総数に比例するため、
    // ゲート無しの断片が 1 つでも混ざると全体の tick が落ちる。分割はその危険を
    // 分割数ぶんに増幅する（実測: 1,200 断片 × 8 分割 = 9,600 本で 221ms/tick。
    // akari-video-internal contract-2026-08-15-telop-motion-grammar-v0 §6）。
    if (/\bdata-akari-split\s*=/.test(html) && /(^|[^-\w])animation\s*:/.test(html)) {
      const gated = /\[data-akari-active\][^{}]*\.[^{}]*\{[^{}]*animation\s*:/.test(html);
      if (!gated) {
        addFinding(findings, {
          severity: "error",
          check: "overlays.split-animation-gate",
          message:
            "text-split fragment must declare animations under a [data-akari-active] selector",
          path: relativePath(paths.projectRoot, htmlPath),
        });
      }
    }

    for (const [attribute, expected] of libraryFragment ? [] : [
      ["data-start", overlay.start],
      ["data-duration", overlay.duration],
    ]) {
      const actualText = fragment.rootAttributes[attribute];
      if (actualText === undefined) continue;
      const actual = Number(actualText);
      if (!Number.isFinite(actual) || !numbersEqual(actual, expected)) {
        addFinding(findings, {
          severity: "error",
          check: "overlays.data-attributes",
          message: `${attribute} must match edit.json value ${formatNumber(expected)}`,
          path: relativePath(paths.projectRoot, htmlPath),
        });
      }
    }
  }
}

function validateThreeCanvas(html, path, findings) {
  const source = stripHtmlComments(html);
  const raw = [
    ...rawTextElements(source, "script"),
    ...rawTextElements(source, "style"),
  ].sort((left, right) => left.start - right.start);
  let rawIndex = 0;
  let scene = false;
  let marked = 0;
  let invalidMarked = false;
  let canvases = 0;
  for (const tag of htmlTags(source)) {
    while (rawIndex < raw.length && tag.start >= raw[rawIndex].end) rawIndex += 1;
    const block = raw[rawIndex];
    if (block && tag.start > block.start && tag.start < block.end) continue;
    const match = /^<([a-z][\w:-]*)\b/iu.exec(tag.text);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const attributes = parseHtmlAttributes(tag.text);
    if (name === "script" && Object.hasOwn(attributes, "data-akari-3d-scene")
      && attributes.type?.toLowerCase() === "application/json") scene = true;
    if (name === "canvas") canvases += 1;
    if (Object.hasOwn(attributes, "data-akari-3d-canvas")) {
      marked += 1;
      if (name !== "canvas") invalidMarked = true;
    }
  }
  if (!scene) return;
  if (marked > 1) addFinding(findings, {
    severity: "error", check: "overlays.three-canvas",
    message: `data-akari-3d-canvas must appear on at most one element (found ${marked}).`, path,
  });
  if (invalidMarked) addFinding(findings, {
    severity: "error", check: "overlays.three-canvas",
    message: "data-akari-3d-canvas must be attached to a <canvas> element.", path,
  });
  if (marked === 0 && canvases > 1) addFinding(findings, {
    severity: "warning", check: "overlays.three-canvas",
    message: "3D renders to the first canvas in document order; add data-akari-3d-canvas to the intended canvas.", path,
  });
}

function validateOverlayFragmentAssets(html, overlay, paths, findings) {
  if (overlay.html.trimStart().startsWith("<")) return;
  const root = realpathSync(paths.projectRoot);
  const outside = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local === ".." || local.startsWith("../") || isAbsolute(local);
  };
  const finding = (reference, check, detail) => addFinding(findings, {
    severity: "error", check: `overlay-fragment-asset-${check}`,
    message: `overlay:${overlay.id} fragment ${overlay.html} の参照 "${reference.raw}"${check === "missing" ? " " : ": "}${detail}`,
    path: relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html)),
  });
  for (const reference of extractAbsoluteFragmentAssetReferences(html, overlay.html)) {
    finding(reference, "absolute-path", "断片からの相対パスで書く");
  }
  for (const reference of extractFragmentAssetReferences(html, overlay.html, overlay.id)) {
    const target = resolve(root, reference.path);
    let actual = target;
    try { actual = realpathSync(target); } catch { /* Missing files are checked below. */ }
    if (outside(target) || outside(actual)) {
      finding(reference, "escapes-project", "escapes the project root");
      continue;
    }
    if (isRegularFileSync(target)) continue;
    const fallback = resolveLibraryFallback({
      projectRoot: paths.projectRoot, declaredPath: reference.path,
      references: paths.assetReferences, libraryRoots: paths.libraryRoots,
    });
    if (fallback.path !== null) continue;
    finding(reference, "missing", "が見つからない。" + describeFragmentAssetHint({
      projectRoot: paths.projectRoot, htmlPath: overlay.html, ...reference,
    }));
  }
}

const fontCmapCache = new Map();

export function runOverlayFragmentFontGlyphCheck(html, overlay, paths, findings, check = validateOverlayFragmentFontGlyphs) {
  const before = findings.length;
  try { check(html, overlay, paths, findings); }
  catch (error) {
    findings.splice(before);
    const name = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/u.test(error.name)
      ? error.name : "Error";
    addFinding(findings, {
      severity: "info", check: "overlays.fragment-font-glyphs",
      message: `overlay:${overlay.id} fragment ${overlay.html}: 字形検査を飛ばしました（${name}）。`,
      path: relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html)),
    });
  }
}

function validateOverlayFragmentFontGlyphs(html, overlay, paths, findings) {
  const faces = fragmentFontFaces(html, overlay.html);
  if (faces.length === 0) return;
  const fragmentPath = relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html));
  const context = `overlay:${overlay.id} fragment ${overlay.html}`;
  const add = (severity, message) => addFinding(findings, {
    severity, check: "overlays.fragment-font-glyphs", message: `${context}: ${message}`, path: fragmentPath,
  });
  const { codepoints, hasDynamicScript } = collectFragmentCodepoints(html, {
    params: overlay.params, vars: overlay.vars, mode: "render",
  });
  let rootTag;
  for (const tag of htmlTags(stripHtmlComments(html))) {
    if (/^<[a-z]/iu.test(tag.text)) { rootTag = tag; break; }
  }
  const hasDeclaredChars = rootTag && Object.hasOwn(parseHtmlAttributes(rootTag.text), "data-akari-font-chars");
  if (hasDynamicScript && !hasDeclaredChars) {
    add("info", "script が生成する字は静的に集めきれません。data-akari-font-chars で宣言できます。");
  }
  const fontSets = [];
  const fontPaths = [];
  const seenSources = new Set();
  let unreadable = false;
  for (const face of faces) if (face.sources.length === 0) {
    unreadable = true;
    add("info", `@font-face (${face.family || "名称なし"}) に読める書体参照がありません。`);
  }
  const root = realpathSync(paths.projectRoot);
  const outside = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local === ".." || local.startsWith("../") || isAbsolute(local);
  };
  for (const face of faces) for (const source of face.sources) {
    const sourceKey = source.data ?? source.path;
    if (seenSources.has(sourceKey)) continue;
    seenSources.add(sourceKey);
    let result;
    let label;
    if (source.data) {
      label = "data:…";
      try {
        const comma = source.data.indexOf(",");
        if (comma < 0) throw Error("invalid data URI");
        const header = source.data.slice(0, comma);
        const bytes = /;base64$/iu.test(header)
          ? Buffer.from(source.data.slice(comma + 1), "base64")
          : Buffer.from(decodeURIComponent(source.data.slice(comma + 1)), "latin1");
        result = readFontCodepoints(bytes);
      } catch { result = { ok: false }; }
    } else {
      label = source.path;
      const target = resolve(root, source.path);
      if (outside(target)) {
        unreadable = true;
        fontPaths.push(label);
        add("info", `書体 ${label} はプロジェクト外の参照なので読みません。`);
        continue;
      }
      const binding = resolveReferenceBinding(paths.editPath, source.path, paths);
      try {
        const real = realpathSync(binding.path);
        if (binding.scope !== "library" && outside(real)) {
          unreadable = true;
          fontPaths.push(label);
          add("info", `書体 ${label} はプロジェクト外の参照なので読みません。`);
          continue;
        }
        const stat = statSync(real);
        if (!stat.isFile()) throw Error("not a file");
        const cached = fontCmapCache.get(real);
        if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) result = cached.result;
        else {
          result = readFontCodepoints(real);
          fontCmapCache.set(real, { size: stat.size, mtimeMs: stat.mtimeMs, result });
        }
      } catch (error) { result = { ok: false, missing: error?.code === "ENOENT" }; }
    }
    fontPaths.push(label);
    if (!result.ok) {
      unreadable = true;
      add("info", `書体 ${label} は${result.missing ? "見つからない" : "読めない（書体データを解析できません）"}。`);
      continue;
    }
    fontSets.push(result.codepoints);
  }
  if (fontSets.length === 0 || unreadable) return;
  const missing = [...codepoints].filter(cp => !fontSets.some(points => points.has(cp))).sort((a, b) => a - b);
  if (missing.length) {
    const sample = missing.slice(0, 20).map(cp => `${String.fromCodePoint(cp)}(U+${cp.toString(16).toUpperCase().padStart(4, "0")})`).join(" ");
    add("warning", `書体 ${fontPaths.join(", ")} の和集合に無い字 ${missing.length} 件 (${sample})。要素ごとの書体の欠けは検出できません。`);
  }
}

// --x/--y/--scale/--rotate はランタイム予約変数（renderOverlayNode が
// .akari-overlay-container へ必ずインライン設定する。packages/render-cut/src/rasterize.mjs）。
// 断片が var(--x, 80px) のように参照すると、フォールバックではなくランタイムが設定した
// 継承値へ解決される（実機バグ報告 overlay-css-var-collision、2026-08-17）。エラーにはしない —
// ランタイムが設定した値を意図的に読む正当用途があり得るため警告に留める。
const RESERVED_OVERLAY_VARS = ["--x", "--y", "--scale", "--rotate"];

// 前方一致誤検知（--xanadu 等）を避けるため、予約名の直後が CSS カスタムプロパティ名の
// 継続文字（英数字・アンダースコア・ハイフン）でないことを確認する。
function findReservedOverlayVarReferences(html) {
  const found = [];
  for (const name of RESERVED_OVERLAY_VARS) {
    const pattern = new RegExp(`var\\(\\s*${name}(?![A-Za-z0-9_-])`);
    if (pattern.test(html)) found.push(name);
  }
  return found;
}

function validateOverlayReservedCssVarReferences(html, path, findings) {
  if (!isNonEmptyString(html)) return;
  for (const name of findReservedOverlayVarReferences(html)) {
    addFinding(findings, {
      severity: "warning",
      check: "overlays.reserved-css-var-reference",
      message:
        `overlay fragment references var(${name}, ...) -- ${name} is a runtime-reserved variable that `
          + "renderOverlayNode always sets inline on the container (packages/render-cut/src/rasterize.mjs), "
          + "so the fallback never applies and it resolves to the runtime's inherited value instead "
          + `(bug report: overlay-css-var-collision, 2026-08-17). Use a non-reserved name for custom knobs `
          + "(e.g. --block-left).",
      path,
    });
  }
}

function validateOverlayMotionRules(html, path, findings) {
  if (!isNonEmptyString(html)) return;
  const parsed = parseOverlayStyles(html);

  for (const keyframes of parsed.keyframes.values()) {
    if (keyframes.steps.size < 2) continue;
    const properties = new Set();
    for (const declarations of keyframes.steps.values()) {
      for (const property of declarations.keys()) properties.add(property);
    }
    if (properties.size === 0) continue;
    const missingAtStart = missingProperties(properties, keyframes.steps.get(0));
    const missingAtEnd = missingProperties(properties, keyframes.steps.get(100));
    if (missingAtStart.length === 0 && missingAtEnd.length === 0) continue;
    const details = [
      ...(missingAtStart.length > 0 ? [`0% missing ${missingAtStart.join(", ")}`] : []),
      ...(missingAtEnd.length > 0 ? [`100% missing ${missingAtEnd.join(", ")}`] : []),
    ].join("; ");
    addFinding(findings, {
      severity: "warning",
      check: "overlays.keyframes-sparse",
      message: `@keyframes ${keyframes.name} has sparse endpoint declarations (${details}); declare every animated property at both endpoints.`,
      path,
    });
  }

  const rulesBySelector = new Map();
  for (const rule of parsed.rules) {
    const selectors = splitCssTopLevel(rule.selector, ",");
    if (selectors === null) continue;
    for (const selector of selectors) {
      const normalized = normalizeMotionSelector(selector);
      if (normalized === null) continue;
      const group = rulesBySelector.get(normalized.selector) ?? {
        selector: normalized.selector,
        baseDeclarations: new Map(),
        rules: [],
      };
      group.rules.push(rule.declarations);
      if (!normalized.gated) {
        for (const [property, value] of rule.declarations) {
          group.baseDeclarations.set(property, value);
        }
      }
      rulesBySelector.set(normalized.selector, group);
    }
  }

  for (const group of rulesBySelector.values()) {
    const animationNames = new Set();
    for (const declarations of group.rules) {
      for (const name of referencedKeyframeNames(declarations, parsed.keyframes)) {
        animationNames.add(name);
      }
    }
    if (animationNames.size === 0) continue;

    const hiddenState = baseHiddenState(group.baseDeclarations);
    const visibleAnimations = [...animationNames].filter((name) => {
      const endpoint = parsed.keyframes.get(name)?.steps.get(100);
      return endpoint !== undefined && endpointClearsHiddenState(endpoint, hiddenState);
    });
    if (hiddenState !== null && visibleAnimations.length > 0) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.base-hidden-state",
        message: `Selector ${JSON.stringify(group.selector)} has a hidden base state but animation ${JSON.stringify(visibleAnimations[0])} ends visible; make the base the final resting state and put the hidden state only in the 0% keyframe.`,
        path,
      });
    }

    const preserves3d = group.rules.some(
      (declarations) => declarations.get("transform-style")?.trim().toLowerCase() === "preserve-3d",
    );
    if (!preserves3d) continue;
    const opacityAnimations = [...animationNames].filter((name) => {
      const keyframes = parsed.keyframes.get(name);
      return keyframes !== undefined
        && [...keyframes.steps.values()].some((declarations) => declarations.has("opacity"));
    });
    if (opacityAnimations.length > 0) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.preserve-3d-opacity-animation",
        message: `Selector ${JSON.stringify(group.selector)} combines transform-style: preserve-3d with opacity animation ${JSON.stringify(opacityAnimations[0])}; Blink flattens transform-style while opacity is animated, so move opacity to a parent and keep the preserve-3d element dedicated to transforms.`,
        path,
      });
    }
  }
}

// 2026-08-07 オーナー裁定・確定: overlays[].role==="background"
// は「動かせない・必ずフレームを埋める」種別で、取りうる状態のほぼ全部が正しくなければならない。
// host（preview-server の app.js / shell の overlay-runtime.js の mount・render-cut の
// rasterize.mjs の renderOverlayNode）は role==="background" のとき --x/--y/--scale/--rotate を
// 無条件で恒等値へロックするため実害は出ないが、死んだ／誤解を招くデータ（動かないのに
// transform を持つ・vars 経由の抜け道・重なった区間）を保存させない最後の砦として、
// JSON Schema では表現できない 3 条件（vars の自由形・区間の重なりは兄弟要素比較）をここで弾く。
const BACKGROUND_LOCKED_VARS = new Set(["--x", "--y", "--scale", "--rotate"]);

function validateOverlayBackgroundRole(overlays, findings) {
  if (!Array.isArray(overlays)) return;
  const segments = [];
  overlays.forEach((overlay, index) => {
    if (!isRecord(overlay) || !Object.hasOwn(overlay, "role")) return;
    const path = `edit.json#overlays[${index}]`;

    if (overlay.role !== "background") {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role",
        message: 'overlay role must be "background" when present',
        path: `${path}.role`,
      });
      return;
    }

    if (Object.hasOwn(overlay, "transform")) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role.transform",
        message: "background overlay must not declare transform (position is locked to the output frame)",
        path: `${path}.transform`,
      });
    }

    if (isRecord(overlay.vars)) {
      for (const key of Object.keys(overlay.vars)) {
        if (BACKGROUND_LOCKED_VARS.has(key)) {
          addFinding(findings, {
            severity: "error",
            check: "overlays.role.vars",
            message: `background overlay must not override ${key} via vars (would move the background off the output frame)`,
            path: `${path}.vars`,
          });
        }
      }
    }

    if (isFiniteNumber(overlay.start) && isPositiveNumber(overlay.duration)) {
      // 背景は「今どの場面か」を表す 1 枚地の差し替え物なので、track の値に関係なく
      // 同時に 2 枚以上表示できてはいけない（cuts.track-overlap と同じ error 重大度）。
      segments.push({
        index,
        track: "background",
        start: overlay.start,
        end: overlay.start + overlay.duration,
      });
    }
  });

  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "error",
      check: "overlays.role.overlap",
      message: "background overlay overlaps another background overlay (only one background may be visible at a time)",
      path: `edit.json#overlays[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
}

function extractAnalysisDuration(analysis) {
  const candidates = [
    analysis?.duration,
    analysis?.source?.duration,
    analysis?.media?.duration,
    analysis?.metadata?.duration,
  ];
  return candidates.find(isPositiveNumber) ?? null;
}

function inputOverride(options, projectRoot, filePath) {
  const overrides = options.inputOverrides;
  if (!overrides || typeof overrides !== "object") return undefined;
  const key = relative(projectRoot, filePath).split("\\").join("/");
  return Object.hasOwn(overrides, key) ? { present: true, text: overrides[key] } : undefined;
}

async function readOptionalJson(filePath, label, override) {
  if (override?.present) {
    if (override.text === null) return { exists: false };
    if (typeof override.text !== "string") {
      throw new ExecutionError(`${label} cannot be read: invalid in-memory override`);
    }
    try {
      return { exists: true, text: override.text, value: JSON.parse(override.text) };
    } catch (error) {
      return { exists: true, text: override.text, error: messageOf(error) };
    }
  }
  try {
    const text = await readFile(filePath, "utf8");
    try {
      return { exists: true, text, value: JSON.parse(text) };
    } catch (error) {
      return { exists: true, text, error: messageOf(error) };
    }
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    throw new ExecutionError(`${label} cannot be read: ${messageOf(error)}`);
  }
}

function finalizeFindings(findings) {
  return findings
    .map((finding) => ({ ...finding }))
    .sort(compareFindings)
    .map((finding, index) => ({
      id: `F${String(index + 1).padStart(3, "0")}`,
      severity: finding.severity,
      check: finding.check,
      message: finding.message,
      ...(finding.path ? { path: finding.path } : {}),
      ...(finding.range ? { range: finding.range } : {}),
      ...(finding.details ? { details: finding.details } : {}),
    }));
}

function compareFindings(left, right) {
  return ["check", "severity", "path", "message"]
    .map((field) => String(left[field] ?? "").localeCompare(String(right[field] ?? ""), "en"))
    .find((value) => value !== 0) ?? 0;
}

function finalizeSkipped(skipped) {
  const unique = new Map();
  for (const item of skipped) unique.set(`${item.check}\0${item.reason}`, item);
  return [...unique.values()].sort(
    (left, right) =>
      left.check.localeCompare(right.check, "en") ||
      left.reason.localeCompare(right.reason, "en"),
  );
}

function parseThreshold(value, option) {
  const number = parseNumber(value, option);
  if (number <= 0) throw new ExecutionError(`${option} must be greater than zero`);
  return number;
}

function parseNumber(value, option) {
  if (value === undefined || value === "") {
    throw new ExecutionError(`${option} requires a numeric value`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ExecutionError(`${option} must be a finite number`);
  return number;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
