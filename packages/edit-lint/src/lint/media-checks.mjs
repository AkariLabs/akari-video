import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { EPSILON, addFinding, addSkipped, effectiveSourceOut, formatDb, formatNumber, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord, messageOf, relativePath, resolveReference } from "./shared.mjs";
import { parseSilenceIntervals, parseVolumeLevels, probeMediaAudio, probeProxyGop, probeVideoDimensions, runCommand } from "./media-probe.mjs";

export function runReferencedMediaChecks(rawEdit, projectedEdit, findings, skipped, paths, options, captionsRoot) {
  const declaredSources = Array.isArray(rawEdit?.sources)
    ? rawEdit.sources
    : Array.isArray(projectedEdit?.sources) ? projectedEdit.sources : [];
  const sourcesById = new Map(declaredSources
    .filter((source) => isRecord(source) && isNonEmptyString(source.id))
    .map((source) => [source.id, source]));
  const referencedSourceIds = new Set();
  const visualSourceIds = new Set();
  const visualCuts = [];
  const narrationItems = [];
  // media.source-range はレーンを問わず（袋・グループの入れ子も含めて）全 media item を見る。
  // 既存 3 検査の入力（referencedSourceIds / visualCuts / narrationItems）は変えない。
  const rangeItems = [];
  const rangeSourceIds = new Set();

  if (rawEdit?.version === 2 && Array.isArray(rawEdit.tracks)) {
    for (const [trackIndex, track] of rawEdit.tracks.entries()) {
      if (!isRecord(track) || !Array.isArray(track.items)) continue;
      const collectRange = (items, pathPrefix) => {
        for (const [itemIndex, item] of items.entries()) {
          if (!isRecord(item)) continue;
          const itemPath = `${pathPrefix}[${itemIndex}]`;
          if (isRecord(item.source) && item.source.kind === "media"
            && isNonEmptyString(item.source.src)) {
            rangeItems.push({ item, sourceId: item.source.src, itemPath });
            rangeSourceIds.add(item.source.src);
          }
          if (Array.isArray(item.items)) collectRange(item.items, `${itemPath}.items`);
        }
      };
      collectRange(track.items, `edit.json#tracks[${trackIndex}].items`);
      for (const [itemIndex, item] of track.items.entries()) {
        if (!isRecord(item) || !isRecord(item.source) || item.source.kind !== "media"
          || !isNonEmptyString(item.source.src)) continue;
        const sourceId = item.source.src;
        referencedSourceIds.add(sourceId);
        const itemPath = `edit.json#tracks[${trackIndex}].items[${itemIndex}]`;
        if (track.lane === "visual") {
          visualSourceIds.add(sourceId);
          visualCuts.push({ item, sourceId, itemPath });
        } else if (track.lane === "audio" && item.role === "narration") {
          narrationItems.push({ item, sourceId, itemPath });
        }
      }
    }
  } else if (Array.isArray(projectedEdit?.cuts)) {
    for (const [index, cut] of projectedEdit.cuts.entries()) {
      if (!isRecord(cut) || !isNonEmptyString(cut.src)) continue;
      referencedSourceIds.add(cut.src);
      visualSourceIds.add(cut.src);
      const itemPath = `edit.json#cuts[${index}]`;
      const projectedItem = { id: cut.id ?? `cut-${index + 1}`, source: cut };
      visualCuts.push({ item: projectedItem, sourceId: cut.src, itemPath });
      rangeItems.push({ item: projectedItem, sourceId: cut.src, itemPath });
      rangeSourceIds.add(cut.src);
    }
  }

  if (referencedSourceIds.size === 0) {
    addSkipped(skipped, "media", "no sources[] entries are referenced by media items");
  }

  const probeByPath = new Map();
  const probeForPath = (filePath) => {
    if (!probeByPath.has(filePath)) {
      probeByPath.set(filePath, probeMediaAudio(filePath, options.ffprobeCommand));
    }
    return probeByPath.get(filePath);
  };
  const probeBySourceId = new Map();
  const captionBinding = bindCaptionsToVisualSource(captionsRoot, visualSourceIds);
  if (captionBinding.sourceId === null) {
    addSkipped(skipped, "media.caption-silence-coverage", captionBinding.reason);
  }

  for (const sourceId of referencedSourceIds) {
    const source = sourcesById.get(sourceId);
    if (!source || !isNonEmptyString(source.path)) {
      addSkipped(skipped, "media", `source ${sourceId}: source path is unavailable`);
      continue;
    }
    const sourcePath = resolveReference(paths.editPath, source.path, paths);
    const probe = probeForPath(sourcePath);
    probeBySourceId.set(sourceId, probe);
    runMediaChecks(
      { id: sourceId, path: sourcePath },
      probe,
      findings,
      skipped,
      paths,
      options,
      captionBinding.sourceId === sourceId ? captionBinding.captions : undefined,
    );
  }

  // range 検査だけが参照する source（入れ子・音声レーン）も同じ path キャッシュで probe する。
  // 既存検査（silence / volume）の対象集合は referencedSourceIds のままで変えない。
  for (const sourceId of rangeSourceIds) {
    if (probeBySourceId.has(sourceId)) continue;
    const source = sourcesById.get(sourceId);
    if (!source || !isNonEmptyString(source.path)) continue;
    probeBySourceId.set(sourceId, probeForPath(resolveReference(paths.editPath, source.path, paths)));
  }

  const fps = projectedEdit?.output?.fps;
  validateVisualAudioDuration(
    visualCuts,
    probeBySourceId,
    findings,
    skipped,
    fps,
  );
  validateMediaSourceRange(rangeItems, probeBySourceId, sourcesById, findings, skipped, fps);
  validateNarrationMediaStart(narrationItems, probeBySourceId, findings, skipped);
  validateCropScaleProxyRatio(rangeItems, sourcesById, findings, skipped, paths, options);

  if (Array.isArray(rawEdit?.audio?.narration)) {
    for (const [index, item] of rawEdit.audio.narration.entries()) {
      if (!isRecord(item) || !isNonEmptyString(item.path) || !isFiniteNumber(item.in)
        || item.in < 0) continue;
      const filePath = resolveReference(paths.editPath, item.path, paths);
      const probe = probeForPath(filePath);
      addNarrationStartWarning(
        item.id ?? `narration-${index + 1}`,
        item.in,
        probe,
        `edit.json#audio.narration[${index}].in`,
        findings,
      );
    }
  }

  // v1 形の audio 宣言（path 直指定）も同じ実尺で見る。bgm は schema に out が無いので in だけ。
  for (const key of ["narration", "sfx"]) {
    const entries = rawEdit?.audio?.[key];
    if (!Array.isArray(entries)) continue;
    for (const [index, item] of entries.entries()) {
      if (!isRecord(item) || !isNonEmptyString(item.path)) continue;
      const probe = probeForPath(resolveReference(paths.editPath, item.path, paths));
      if (!isPositiveNumber(probe?.containerDuration)) continue;
      addSourceRangeFindings({
        label: isNonEmptyString(item.id) ? item.id : `${key}-${index + 1}`,
        duration: probe.containerDuration,
        inSeconds: isFiniteNumber(item.in) ? item.in : 0,
        outSeconds: isFiniteNumber(item.out) ? item.out : null,
        pathPrefix: `edit.json#audio.${key}[${index}]`,
        pathSuffix: "",
        findings,
      });
    }
  }
  const declaredBgm = rawEdit?.audio?.bgm;
  if (isRecord(declaredBgm) && isNonEmptyString(declaredBgm.path)) {
    const probe = probeForPath(resolveReference(paths.editPath, declaredBgm.path, paths));
    if (isPositiveNumber(probe?.containerDuration)) {
      addSourceRangeFindings({
        label: "bgm",
        duration: probe.containerDuration,
        inSeconds: isFiniteNumber(declaredBgm.in) ? declaredBgm.in : 0,
        outSeconds: isFiniteNumber(declaredBgm.out) ? declaredBgm.out : null,
        pathPrefix: "edit.json#audio.bgm",
        pathSuffix: "",
        findings,
      });
    }
  }
}

export function runSourceVfrChecks(rawEdit, projectedEdit, findings, paths) {
  const declaredSources = Array.isArray(rawEdit?.sources)
    ? rawEdit.sources
    : Array.isArray(projectedEdit?.sources) ? projectedEdit.sources : [];
  const sourcesById = new Map(declaredSources
    .filter((source) => isRecord(source) && isNonEmptyString(source.id))
    .map((source) => [source.id, source]));
  const referencedSourceIds = new Set();
  if (rawEdit?.version === 2 && Array.isArray(rawEdit.tracks)) {
    for (const track of rawEdit.tracks) {
      if (!isRecord(track) || !Array.isArray(track.items)) continue;
      for (const item of track.items) {
        if (isRecord(item) && isRecord(item.source) && item.source.kind === "media"
          && isNonEmptyString(item.source.src)) {
          referencedSourceIds.add(item.source.src);
        }
      }
    }
  } else if (Array.isArray(projectedEdit?.cuts)) {
    for (const cut of projectedEdit.cuts) {
      if (isRecord(cut) && isNonEmptyString(cut.src)) referencedSourceIds.add(cut.src);
    }
  }
  for (const sourceId of referencedSourceIds) {
    const source = sourcesById.get(sourceId);
    if (source && isNonEmptyString(source.path)) {
      addSourceVfrFinding(source, declaredSources.indexOf(source), findings, paths);
    }
  }
}

function addSourceVfrFinding(source, sourceIndex, findings, paths) {
  const analysisPath = sourceAnalysisPath(paths.projectRoot, source.path);
  if (analysisPath === null) return;
  let timing;
  try {
    timing = JSON.parse(readFileSync(analysisPath, "utf8"))?.probe?.video?.frame_timing;
  } catch {
    return;
  }
  if (!isRecord(timing) || timing.mode !== "vfr") return;
  const irregularDeltas = Number.isFinite(timing.irregular_deltas) ? timing.irregular_deltas : 0;
  const maxDeviationMs = Number.isFinite(timing.max_deviation_ms) ? timing.max_deviation_ms : 0;
  const cumulativeDriftMs = Number.isFinite(timing.cumulative_drift_ms)
    ? timing.cumulative_drift_ms
    : 0;
  const nominalFrameMs = Number.isFinite(timing.nominal_frame_ms) ? timing.nominal_frame_ms : 0;
  let message = `この素材は可変フレームレートです（ぶれ ${formatNumber(irregularDeltas)} 回・最大 ${formatNumber(maxDeviationMs)} ms）。最近傍で写像しています`;
  if (nominalFrameMs > 0 && Math.abs(cumulativeDriftMs) > nominalFrameMs / 2) {
    message += "。固定フレームレートに変換すると音ズレを防げます（任意）";
  }
  addFinding(findings, {
    severity: "warning",
    check: "source.vfr",
    message,
    path: `edit.json#sources[${sourceIndex}].path`,
  });
}

function sourceAnalysisPath(projectRoot, sourcePath) {
  if (!isNonEmptyString(sourcePath) || isAbsolute(sourcePath)) return null;
  const resolvedSource = resolve(projectRoot, sourcePath);
  const projectRelative = relative(projectRoot, resolvedSource);
  if (projectRelative.startsWith("..") || isAbsolute(projectRelative)) return null;
  const posixRelative = projectRelative.split("\\").join("/");
  return join(
    projectRoot,
    ".akari",
    "sidecars",
    `${posixRelative}.analysis`,
    "analysis.json",
  );
}

function bindCaptionsToVisualSource(captionsRoot, visualSourceIds) {
  const captions = Array.isArray(captionsRoot)
    ? captionsRoot
    : isRecord(captionsRoot) && Array.isArray(captionsRoot.captions)
      ? captionsRoot.captions : null;
  if (!captions || captions.length === 0) {
    return {
      sourceId: null,
      captions: null,
      reason: "captions are absent or empty; caption/silence coverage has no input",
    };
  }
  const explicitSourceIds = new Set(captions
    .filter(isRecord)
    .map((caption) => caption.src)
    .filter(isNonEmptyString));
  const everyCaptionHasSource = captions.every(
    (caption) => isRecord(caption) && isNonEmptyString(caption.src),
  );
  if (everyCaptionHasSource && explicitSourceIds.size === 1) {
    const [sourceId] = explicitSourceIds;
    if (visualSourceIds.has(sourceId)) return { sourceId, captions, reason: null };
  }
  if (visualSourceIds.size === 1) {
    const [sourceId] = visualSourceIds;
    if (explicitSourceIds.size === 0
      || (explicitSourceIds.size === 1 && explicitSourceIds.has(sourceId))) {
      return { sourceId, captions, reason: null };
    }
  }
  return {
    sourceId: null,
    captions: null,
    reason: "captions cannot be associated with exactly one referenced visual source",
  };
}

function validateVisualAudioDuration(visualCuts, probeBySourceId, findings, skipped, fps) {
  const unavailableSourceIds = new Set();
  for (const { item, sourceId, itemPath } of visualCuts) {
    const probe = probeBySourceId.get(sourceId);
    if (probe?.hasAudio !== true || !isPositiveNumber(probe.duration)) {
      unavailableSourceIds.add(sourceId);
      continue;
    }
    const effectiveOut = effectiveSourceOut(item, fps);
    if (!isFiniteNumber(effectiveOut) || effectiveOut <= probe.duration + EPSILON) continue;
    // 素材そのものの実尺を超えているぶんは media.source-range が error で出す。
    // この検査が見るのは「コンテナ内で音声ストリームだけが先に終わる」素材。
    if (isPositiveNumber(probe.containerDuration)
      && effectiveOut > probe.containerDuration + EPSILON) continue;
    const itemId = isNonEmptyString(item.id) ? item.id : "media item";
    addFinding(findings, {
      severity: "warning",
      check: "media.audio-shorter-than-out",
      message: `${itemId}: audio stream ends at ${probe.duration.toFixed(3)}s but out=${effectiveOut.toFixed(3)}s (short by ${(effectiveOut - probe.duration).toFixed(3)}s)`,
      path: `${itemPath}.source[src=${sourceId}]`,
    });
  }
  for (const sourceId of unavailableSourceIds) {
    addSkipped(
      skipped,
      "media.audio-shorter-than-out",
      `source ${sourceId}: audio stream duration is unavailable`,
    );
  }
}

/**
 * 実在しない区間の要求を素材のコンテナ実尺で弾く（issue #68）。
 * media.audio-shorter-than-out は音声ストリーム基準のため、音声を持たない映像と
 * audio レーンの item（bgm / narration / sfx）が無検査のまま PASS していた。
 * レーンも入れ子も問わず、in / out を実尺と突き合わせて error にする。
 */
function validateMediaSourceRange(rangeItems, probeBySourceId, sourcesById, findings, skipped, fps) {
  const unavailableSourceIds = new Set();
  for (const { item, sourceId, itemPath } of rangeItems) {
    const probe = probeBySourceId.get(sourceId);
    if (!probe || !isPositiveNumber(probe.containerDuration)) {
      if (sourcesById.has(sourceId)) unavailableSourceIds.add(sourceId);
      continue;
    }
    addSourceRangeFindings({
      label: isNonEmptyString(item.id) ? item.id : "media item",
      duration: probe.containerDuration,
      inSeconds: isFiniteNumber(item.source?.in) ? item.source.in : 0,
      outSeconds: effectiveSourceOut(item, fps),
      pathPrefix: `${itemPath}.source`,
      pathSuffix: `[src=${sourceId}]`,
      findings,
    });
  }
  for (const sourceId of unavailableSourceIds) {
    addSkipped(
      skipped,
      "media.source-range",
      `source ${sourceId}: container duration is unavailable`,
    );
  }
}

function addSourceRangeFindings(
  { label, duration, inSeconds, outSeconds, pathPrefix, pathSuffix, findings },
) {
  if (isFiniteNumber(inSeconds) && inSeconds >= duration - EPSILON) {
    addFinding(findings, {
      severity: "error",
      check: "media.source-range",
      message: `${label}: in=${inSeconds.toFixed(3)}s は素材の実尺 ${duration.toFixed(3)}s 以上です（その先に素材がありません）`,
      path: `${pathPrefix}.in${pathSuffix}`,
    });
    return;
  }
  if (isFiniteNumber(outSeconds) && outSeconds > duration + EPSILON) {
    addFinding(findings, {
      severity: "error",
      check: "media.source-range",
      message: `${label}: out=${outSeconds.toFixed(3)}s が素材の実尺 ${duration.toFixed(3)}s を ${(outSeconds - duration).toFixed(3)}s 超えています（存在しない区間の要求）`,
      path: `${pathPrefix}.out${pathSuffix}`,
    });
  }
}

function validateNarrationMediaStart(narrationItems, probeBySourceId, findings, skipped) {
  const unavailableSourceIds = new Set();
  for (const { item, sourceId, itemPath } of narrationItems) {
    if (!isFiniteNumber(item.source?.in) || item.source.in < 0) continue;
    const probe = probeBySourceId.get(sourceId);
    if (probe?.hasAudio !== true || !isPositiveNumber(probe.duration)) {
      unavailableSourceIds.add(sourceId);
      continue;
    }
    addNarrationStartWarning(
      item.id,
      item.source.in,
      probe,
      `${itemPath}.source.in[src=${sourceId}]`,
      findings,
    );
  }
  for (const sourceId of unavailableSourceIds) {
    addSkipped(
      skipped,
      "audio.narration.trim",
      `source ${sourceId}: media trim bound check requires an audio stream duration`,
    );
  }
}

function addNarrationStartWarning(itemId, inSeconds, probe, path, findings) {
  if (probe?.hasAudio !== true || !isPositiveNumber(probe.duration)
    || inSeconds < probe.duration - EPSILON) return;
  // 素材の実尺そのものを超えているぶんは media.source-range が error で出す。
  if (isPositiveNumber(probe.containerDuration)
    && inSeconds >= probe.containerDuration - EPSILON) return;
  addFinding(findings, {
    severity: "warning",
    check: "audio.narration.trim",
    message: `${String(itemId)}: in=${inSeconds.toFixed(3)}s is at or beyond audio stream duration ${probe.duration.toFixed(3)}s`,
    path,
  });
}

function runMediaChecks(source, audioStream, findings, skipped, paths, options, captions) {
  const sourcePath = source.path;
  const sourceRelative = `${relativePath(paths.projectRoot, sourcePath)}#source=${source.id}`;
  let command = null;
  let silenceIntervals = [];
  if (audioStream.hasAudio === true) {
    command = options.ffmpegCommand ?? process.env.FFMPEG ?? resolveFfmpeg();
    const silence = runCommand(command, [
      "-hide_banner",
      "-nostdin",
      "-i",
      sourcePath,
      "-vn",
      "-af",
      "silencedetect=noise=-50dB:d=0.5",
      "-f",
      "null",
      "-",
    ]);
    silenceIntervals = parseSilenceIntervals(silence.stderr);
  } else {
    addSkipped(skipped, "media.silence", `source ${source.id}: ${audioStream.reason}`);
  }
  for (const interval of silenceIntervals) {
    const severity =
      options.silenceErrorSeconds !== null &&
      interval.duration >= options.silenceErrorSeconds - EPSILON
        ? "error"
        : "warning";
    addFinding(findings, {
      severity,
      check: "media.silence",
      message: `silence detected for ${formatNumber(interval.duration)}s`,
      path: sourceRelative,
      range: { start: interval.start, end: interval.end },
    });
  }
  const captionSilenceIntervals = silenceIntervals.filter(
    (interval) => interval.duration >= 1.0 - EPSILON,
  );
  if (Array.isArray(captions)) {
    const validCaptions = captions.filter(
      (caption) =>
        isFiniteNumber(caption?.start) &&
        isFiniteNumber(caption?.end) &&
        caption.end > caption.start,
    );
    const totalCaptionSeconds = validCaptions.reduce(
      (total, caption) => total + (caption.end - caption.start),
      0,
    );
    const overlapSeconds = validCaptions.reduce(
      (total, caption) =>
        total +
        captionSilenceIntervals.reduce(
          (captionTotal, interval) =>
            captionTotal +
            Math.max(
              0,
              Math.min(caption.end, interval.end) -
                Math.max(caption.start, interval.start),
            ),
          0,
        ),
      0,
    );
    if (totalCaptionSeconds > 0) {
      const thresholdPercent = options.captionSilenceWarnPercent ?? 30;
      const coveragePercent = (100 * overlapSeconds) / totalCaptionSeconds;
      if (coveragePercent > thresholdPercent + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "media.caption-silence-coverage",
          message: `captions cover ${coveragePercent.toFixed(1)}% of their total display time with silence (>=1.0s intervals); threshold is ${thresholdPercent}%`,
          path: `${relativePath(paths.projectRoot, paths.captionsPath)}#source=${source.id}`,
        });
      }
    } else {
      addSkipped(
        skipped,
        "media.caption-silence-coverage",
        `source ${source.id}: captions contain no valid positive-duration intervals`,
      );
    }
  }

  if (audioStream.hasAudio !== true) {
    if (Array.isArray(captions)) {
      addSkipped(
        skipped,
        "media.caption-silence-coverage",
        `source ${source.id}: ${audioStream.reason}`,
      );
    }
    addSkipped(skipped, "media.volume", `source ${source.id}: ${audioStream.reason}`);
    return;
  }

  const volume = runCommand(command, [
    "-hide_banner",
    "-nostdin",
    "-i",
    sourcePath,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const levels = parseVolumeLevels(volume.stderr);
  if (levels.max !== null || levels.mean !== null) {
    const tooLoud =
      levels.max !== null &&
      options.maxVolumeErrorDb !== null &&
      levels.max > options.maxVolumeErrorDb + EPSILON;
    addFinding(findings, {
      severity: tooLoud ? "error" : "warning",
      check: "media.volume",
      message: `volume mean=${formatDb(levels.mean)}, max=${formatDb(levels.max)}`,
      path: sourceRelative,
    });
  } else {
    addFinding(findings, {
      severity: "warning",
      check: "media.volume",
      message: "volumedetect returned no audio level values",
      path: sourceRelative,
    });
  }
}

// 原本 / プロキシの寸法比と scale の一致判定に使う相対許容差。回避策期間の値は
// 「原本 ÷ プロキシ」をそのまま書いた比なので、浮動小数の丸め分だけ見ればよい。
const CROP_SCALE_PROXY_RATIO_TOLERANCE = 1e-3;

/**
 * 回避策期間（プレビューがプロキシを復号し、書き出しもプレビュー用プロキシを優先していた頃）に
 * 保存された `transform.scale` を拾う。当時は crop を持つ item の scale へ「原本 ÷ プロキシ」の
 * 寸法比を入れて自己整合させていたため、書き出しが原本を復号する現在はその値がそのまま効いて
 * 構図が寸法比の分だけ膨らむ（不具合メモ 第10項 / 第18項の根本修正後に残る実害）。
 *
 * 寸法比と偶然一致する正当なズームもあり得るので warning に留める（止めずに知らせる）。
 * 判定は静的な `transform.scale` だけを見る。proxy 宣言の無い source・crop の無い item・
 * 寸法が読めない素材は対象外にして誤検知を出さない。
 */
export function findCropScaleProxyRatioFindings(items, ratioOf) {
  // 半々配置の案件では同じ素材の cropped item が 100 件近く並ぶ（実機 2026-09-15: 95 件）。
  // 直せる値は素材ごとに 1 つなので、素材 × scale 単位で 1 件へまとめて件数を添える
  // （geometry.fit-compat が移行案内を 1 件で出すのと同じ方針）。
  const groups = new Map();
  for (const entry of items) {
    const item = entry?.item;
    if (!isRecord(item) || !isRecord(item.crop) || !isRecord(item.transform)) continue;
    const scale = item.transform.scale;
    if (!isPositiveNumber(scale)) continue;
    const measured = ratioOf(entry.sourceId);
    if (!isRecord(measured) || !isPositiveNumber(measured.ratio)) continue;
    const ratio = measured.ratio;
    // 等寸プロキシ（比 1）は既定値 scale=1 と区別できないため見ない。
    if (ratio <= 1 + CROP_SCALE_PROXY_RATIO_TOLERANCE) continue;
    if (Math.abs(scale - ratio) > CROP_SCALE_PROXY_RATIO_TOLERANCE * ratio) continue;
    const key = `${entry.sourceId} ${scale}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { entry, scale, measured, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()].map(({ entry, scale, measured, count }) => {
    const { ratio, original, proxy } = measured;
    return {
      severity: "warning",
      check: "media.crop-scale-proxy-ratio",
      message: `素材 ${entry.sourceId} の crop を持つ item ${count} 件の transform.scale ${formatNumber(scale)} が、`
        + `原本 ÷ プロキシの寸法比（${original.width}x${original.height} ÷ ${proxy.width}x${proxy.height}`
        + ` = ${formatNumber(ratio)}）と一致します。プレビューがプロキシを復号していた時期の回避策の値`
        + `である可能性が高く、原本を復号する現在は構図が約 ${formatNumber(ratio)} 倍に拡大します。`
        + `意図したズームでなければ transform.scale を原本基準（通常 1）へ戻してください。`,
      path: `${entry.itemPath}.transform.scale`,
    };
  });
}

function validateCropScaleProxyRatio(items, sourcesById, findings, skipped, paths, options) {
  const candidates = items.filter((entry) => isRecord(entry?.item)
    && isRecord(entry.item.crop)
    && isRecord(entry.item.transform)
    && isPositiveNumber(entry.item.transform.scale)
    && isNonEmptyString(sourcesById.get(entry.sourceId)?.proxy));
  if (candidates.length === 0) return;

  let command;
  try {
    command = options.ffprobeCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  } catch (error) {
    addSkipped(skipped, "media.crop-scale-proxy-ratio",
      `source dimensions unavailable: ${messageOf(error)}`);
    return;
  }

  const ratioBySourceId = new Map();
  const ratioOf = (sourceId) => {
    if (!ratioBySourceId.has(sourceId)) {
      ratioBySourceId.set(sourceId, proxyDimensionRatio(sourcesById.get(sourceId), paths, command));
    }
    return ratioBySourceId.get(sourceId);
  };
  for (const finding of findCropScaleProxyRatioFindings(candidates, ratioOf)) {
    addFinding(findings, finding);
  }
  for (const [sourceId, measured] of ratioBySourceId) {
    if (measured === null) {
      addSkipped(skipped, "media.crop-scale-proxy-ratio",
        `source ${sourceId}: original / proxy dimensions are unavailable`);
    }
  }
}

/** 原本とプロキシの寸法比。片方でも読めない・縦横で比が違う場合は null（対象外）。 */
function proxyDimensionRatio(source, paths, command) {
  if (!isRecord(source) || !isNonEmptyString(source.path) || !isNonEmptyString(source.proxy)) {
    return null;
  }
  const original = probeVideoDimensions(resolveReference(paths.editPath, source.path, paths), command);
  const proxy = probeVideoDimensions(resolveReference(paths.editPath, source.proxy, paths), command);
  if (original === null || proxy === null) return null;
  const widthRatio = original.width / proxy.width;
  const heightRatio = original.height / proxy.height;
  // アスペクト比を変えたプロキシでは「寸法比」が一意に決まらないので判定しない。
  if (Math.abs(widthRatio - heightRatio) > CROP_SCALE_PROXY_RATIO_TOLERANCE * widthRatio) {
    return null;
  }
  return { ratio: widthRatio, original, proxy };
}

export async function validateProxyGops(rawEdit, findings, paths, options) {
  const declarations = [];
  if (isRecord(rawEdit?.source) && isNonEmptyString(rawEdit.source.proxy)) {
    declarations.push({ value: rawEdit.source.proxy, path: "edit.json#source.proxy" });
  }
  if (Array.isArray(rawEdit?.sources)) {
    for (const [index, source] of rawEdit.sources.entries()) {
      if (isRecord(source) && isNonEmptyString(source.proxy)) {
        declarations.push({ value: source.proxy, path: `edit.json#sources[${index}].proxy` });
      }
    }
  }
  if (declarations.length === 0) return;

  let command;
  try {
    command = options.ffprobeCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  } catch {
    return;
  }

  const cachePath = join(paths.projectRoot, ".akari", "cache", "proxy-gop.json");
  let cache = {};
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8"));
    if (isRecord(parsed)) cache = parsed;
  } catch {
    // A missing or malformed best-effort cache is equivalent to a cold probe.
  }
  let cacheChanged = false;
  const probeByPath = new Map();

  for (const declaration of declarations) {
    const filePath = resolveReference(paths.editPath, declaration.value, paths);
    let fileStat;
    try {
      fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;
    } catch {
      continue;
    }

    let maxKeyframeIntervalSeconds;
    if (probeByPath.has(filePath)) {
      maxKeyframeIntervalSeconds = probeByPath.get(filePath);
    } else {
      const cached = isRecord(cache[filePath]) ? cache[filePath] : null;
      if (cached
        && cached.size === fileStat.size
        && cached.mtimeMs === fileStat.mtimeMs
        && isFiniteNumber(cached.maxKeyframeIntervalSeconds)) {
        maxKeyframeIntervalSeconds = cached.maxKeyframeIntervalSeconds;
      } else {
        maxKeyframeIntervalSeconds = probeProxyGop(filePath, command);
        if (isFiniteNumber(maxKeyframeIntervalSeconds)) {
          cache[filePath] = {
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
            maxKeyframeIntervalSeconds,
          };
          cacheChanged = true;
        }
      }
      probeByPath.set(filePath, maxKeyframeIntervalSeconds);
    }

    if (isFiniteNumber(maxKeyframeIntervalSeconds) && maxKeyframeIntervalSeconds > 2) {
      addFinding(findings, {
        severity: "warning",
        check: "source.proxy-long-gop",
        message: `プロキシの最大キーフレーム間隔が ${maxKeyframeIntervalSeconds.toFixed(3)} 秒のため、プレビューのカット切り替えが遅くなります。GOP 1 秒以下で焼き直してください: ffmpeg -i <input> … -g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0 <output>`,
        path: declaration.path,
      });
    }
  }

  if (cacheChanged && options.writeReports !== false) {
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    } catch {
      // Cache persistence must never change the lint verdict or exit code.
    }
  }
}
