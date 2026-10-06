import { segmentDuration } from "../cut-timeline.mjs";
import { buildMatcher, protectedTermsFrom } from "../../../word-book/src/index.mjs";
import { resolveWordBookSync, scanRecord } from "../../../word-book/src/index.mjs";
import { EPSILON, addFinding, captionFinding, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord, relativePath } from "./shared.mjs";
import { resolveCaptionDisplay } from "./external.mjs";
import { validateCaptionAnimation, validateTextStyle } from "./caption-style.mjs";

export function validateCaptionRunRanges(caption) {
  if (!Array.isArray(caption?.runs)) return [];
  const count = [...new Intl.Segmenter(undefined, { granularity: "grapheme" })
    .segment(typeof caption.display_text === "string" ? caption.display_text : String(caption.text ?? ""))].length;
  return caption.runs.flatMap((run, index) =>
    isRecord(run) && Number.isInteger(run.from) && Number.isInteger(run.to)
      && (run.from < 0 || run.to > count || run.from >= run.to)
      ? [{ index, count, from: run.from, to: run.to }] : []);
}

export function validateCaptions(captions, edit, analysis, findings, paths, cutsEndSeconds, textstylePresetIds) {
  const captionPath = relativePath(paths.projectRoot, paths.captionsPath);
  const captionsRoot = captions;
  const wordBook = resolveWordBookSync({ projectRoot: paths.projectRoot, env: process.env });
  const wordBookMatcher = buildMatcher(wordBook.entries);
  for (const layer of wordBook.layers) {
    if (!layer.error) continue;
    addFinding(findings, {
      severity: "warning",
      check: "word-book.invalid",
      message: `単語帳を読み込めません（${layer.error.code}）: ${layer.error.message}`,
      path: relativePath(paths.projectRoot, layer.path),
    });
  }
  for (const conflict of wordBook.conflicts) {
    addFinding(findings, {
      severity: "info",
      check: "word-book.variant-shadowed",
      message: `variant ${conflict.variant_key} は ${conflict.winner.surface} (${conflict.winner.scope}) が優先され、${conflict.shadowed.map(item => `${item.surface} (${item.scope})`).join(", ")} を隠します`,
      path: captionPath,
    });
  }
  let displayPolicy;
  if (!Array.isArray(captions)) {
    if (!isRecord(captions)) {
      addFinding(findings, {
        severity: "error",
        check: "captions.schema",
        message: "captions.json root must be an array or object",
        path: captionPath,
      });
      return;
    }
    for (const field of Object.keys(captions)) {
      if (field !== "default_text_style"
        && field !== "display_policy"
        && field !== "emphasis_words"
        && field !== "captions") {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 root object`,
          captionPath,
        );
      }
    }
    displayPolicy = captions.display_policy;
    if (Object.hasOwn(captions, "default_text_style")) {
      validateTextStyle(
        captions.default_text_style,
        "default_text_style",
        findings,
        captionPath,
      );
    }
    if (Object.hasOwn(captions, "emphasis_words")) {
      validateEmphasisWords(captions.emphasis_words, findings, captionPath);
    }
    if (!Array.isArray(captions.captions)) {
      captionFinding(
        findings,
        "captions.schema",
        "captions must be an array in the captions.json root object",
        captionPath,
      );
      return;
    }
    captions = captions.captions;
  }
  const ids = new Set();
  // ここには以前 `captions.overlay-link`（caption の id と一致する overlays[].id が無ければ警告）
  // があったが、2026-08-07 に撤去した。字幕のオーバーレイは消費側が captions[] から合成する
  // （render-cut の generateCaptionOverlays）ので、edit.json の overlays[] に手書きで
  // 対応物を並べる設計ではない。実際、このリポジトリ自身の字幕フィクスチャ 6/6 で
  // 全字幕に 1 件ずつ発火し、通るプロジェクトが 1 つも存在しなかった。docs/ にも skills/ にも
  // 意図を説明する記述がなく、テストも 1 件も無い（= 消しても何も落ちない）状態だった。
  // 常に全件発火する警告は本物の指摘を埋めるだけなので、規則ごと落とすのが正しい。
  // 撤去の証跡は edit-lint.test.mjs の "captions.overlay-link は発火しない" で固定してある。
  const previousStart = new Map();
  const furthestEnd = new Map();
  const furthestCaption = new Map();

  for (const [index, caption] of captions.entries()) {
    const itemPath = `captions.json#[${index}]`;
    if (!isRecord(caption)) {
      captionFinding(findings, "captions.schema", "caption must be an object", itemPath);
      continue;
    }
    const required = ["id", "start", "end", "text", "speaker", "sourceRef", "edited"];
    const optional = ["src", "time_domain", "words", "unrecognized", "style", "display_text", "display_fragments", "display_timing", "style_preset", "text_style", "runs"];
    for (const field of required) {
      if (!Object.hasOwn(caption, field)) {
        captionFinding(findings, "captions.schema", `${field} is required`, itemPath);
      }
    }
    for (const field of Object.keys(caption)) {
      if (![...required, ...optional].includes(field)) {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0`,
          itemPath,
        );
      }
    }
    if (Object.hasOwn(caption, "src")) {
      if (!isNonEmptyString(caption.src)) {
        captionFinding(
          findings,
          "captions.schema",
          "src must be a non-empty string when present",
          itemPath,
        );
      } else {
        const sourceIds = new Set(
          Array.isArray(edit.sources)
            ? edit.sources.filter(isRecord).map((source) => source.id)
            : [],
        );
        if (!sourceIds.has(caption.src)) {
          captionFinding(
            findings,
            "captions.src-reference",
            `src does not reference sources[].id: ${caption.src}`,
            itemPath,
          );
        }
      }
    }
    if (Object.hasOwn(caption, "time_domain")
      && caption.time_domain !== "source" && caption.time_domain !== "output") {
      captionFinding(
        findings,
        "captions.schema",
        'time_domain must be "source" or "output" when present',
        itemPath,
      );
    }
    if (typeof caption.id !== "string" || !/^c-\d{4}$/.test(caption.id)) {
      captionFinding(
        findings,
        "captions.schema",
        "id must match c- followed by four digits",
        itemPath,
      );
    } else if (ids.has(caption.id)) {
      captionFinding(findings, "captions.schema", `duplicate id: ${caption.id}`, itemPath);
    } else {
      ids.add(caption.id);
    }
    if (!isNonEmptyString(caption.text)) {
      captionFinding(findings, "captions.schema", "text must be a non-empty string", itemPath);
    }
    if (caption.speaker !== null) {
      captionFinding(findings, "captions.schema", "speaker must be null in v0", itemPath);
    }
    if (typeof caption.edited !== "boolean") {
      captionFinding(findings, "captions.edited", "edited must be a boolean", itemPath);
    }
    if (Object.hasOwn(caption, "style")) {
      if (caption.style !== "plain"
        && caption.style !== "karaoke"
        && caption.style !== "pop"
        && caption.style !== "reveal"
        && caption.style !== "reveal-word") {
        captionFinding(
          findings,
          "captions.schema",
          'style must be "plain", "karaoke", "pop", "reveal", or "reveal-word"',
          itemPath,
        );
      }
    }
    if (Object.hasOwn(caption, "display_text") && typeof caption.display_text !== "string") {
      captionFinding(
        findings,
        "captions.schema",
        "display_text must be a string when present",
        itemPath,
      );
    }
    if (Object.hasOwn(caption, "runs")) {
      const outOfRange = new Map(validateCaptionRunRanges(caption).map(item => [item.index, item]));
      if (!Array.isArray(caption.runs)) {
        captionFinding(findings, "captions.schema", "runs must be an array", itemPath);
      } else caption.runs.forEach((run, runIndex) => {
        const path = `${itemPath}.runs[${runIndex}]`;
        if (!isRecord(run) || !Number.isInteger(run.from) || !Number.isInteger(run.to)
          || (run.role !== undefined && (typeof run.role !== "string" || !run.role))
          || (run.style !== undefined && (!isRecord(run.style)
            || Object.keys(run.style).some(key => !["color", "font_weight", "scale", "baseline_shift_em", "rotate_deg", "letter_spacing_em", "stroke", "italic", "underline"].includes(key))))
          || (run.animation !== undefined && !isRecord(run.animation))
          || Object.keys(run).some(key => !["from", "to", "role", "style", "animation"].includes(key))) {
          captionFinding(findings, "captions.schema", "run has invalid fields or types", path);
          return;
        }
        const range = outOfRange.get(runIndex);
        if (range) {
          addFinding(findings, { severity: "warning", check: "captions.run-range",
            message: `run range [${run.from}, ${run.to}) is outside ${range.count} displayed graphemes or empty; ignored`, path });
        }
        if (run.style) {
          const s = run.style;
          const hex = value => typeof value === "string" && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value);
          const finite = value => typeof value === "number" && Number.isFinite(value);
          if ((s.color !== undefined && !hex(s.color))
            || (s.font_weight !== undefined && (!Number.isInteger(s.font_weight) || s.font_weight < 1 || s.font_weight > 1000))
            || (s.scale !== undefined && (!finite(s.scale) || s.scale <= 0))
            || (s.baseline_shift_em !== undefined && !finite(s.baseline_shift_em))
            || (s.rotate_deg !== undefined && (!finite(s.rotate_deg) || Math.abs(s.rotate_deg) > 180))
            || (s.letter_spacing_em !== undefined && !finite(s.letter_spacing_em))
            || (s.italic !== undefined && typeof s.italic !== "boolean")
            || (s.underline !== undefined && typeof s.underline !== "boolean")
            || (s.stroke !== undefined && (!isRecord(s.stroke)
              || Object.keys(s.stroke).some(key => !["method", "color", "width_px"].includes(key))
              || (s.stroke.color !== undefined && !hex(s.stroke.color))
              || (s.stroke.width_px !== undefined && (!finite(s.stroke.width_px) || s.stroke.width_px < 0))))) {
            captionFinding(findings, "captions.schema", "run style has invalid values", `${path}.style`);
          }
        }
        if (run.animation) validateCaptionAnimation(run.animation, "run.animation", findings, path);
      });
    }
    if (Object.hasOwn(caption, "display_fragments") && !Array.isArray(caption.display_fragments)) {
      captionFinding(findings, "captions.schema", "display_fragments must be an array when present", itemPath);
    }
    if (Object.hasOwn(caption, "display_timing")
      && caption.display_timing !== "full" && caption.display_timing !== "speech-tight") {
      captionFinding(findings, "captions.schema", 'display_timing must be "full" or "speech-tight" when present', itemPath);
    }
    if (Object.hasOwn(caption, "style_preset")) {
      if (typeof caption.style_preset !== "string"
        || !/^[a-z0-9][a-z0-9-]*$/.test(caption.style_preset)) {
        captionFinding(
          findings,
          "captions.schema",
          "style_preset must match ^[a-z0-9][a-z0-9-]*$ when present",
          itemPath,
        );
      } else if (textstylePresetIds && !textstylePresetIds.has(caption.style_preset)) {
        const candidates = [...textstylePresetIds].sort().slice(0, 5);
        addFinding(findings, {
          severity: "warning",
          check: "captions.style-preset-unknown",
          message: `unknown style_preset id: ${caption.style_preset}${candidates.length > 0 ? `; candidates: ${candidates.join(", ")}` : ""}`,
          path: itemPath,
        });
      }
    }
    if (Object.hasOwn(caption, "text_style")) {
      validateTextStyle(caption.text_style, "text_style", findings, itemPath);
    }
    if (Object.hasOwn(caption, "words")) {
      validateCaptionWords(caption.words, caption, findings, itemPath);
    }
    if (Object.hasOwn(caption, "unrecognized")) {
      validateCaptionUnrecognized(caption.unrecognized, caption, findings, itemPath);
    }
    const timesValid =
      isFiniteNumber(caption.start) &&
      isFiniteNumber(caption.end) &&
      caption.start >= 0 &&
      caption.end > caption.start;
    if (!timesValid) {
      captionFinding(
        findings,
        "captions.schema",
        "caption must satisfy 0 <= start < end",
        itemPath,
      );
    } else {
      if (caption.time_domain !== "output") {
        const timeGroup = caption.src;
        const groupPreviousStart = previousStart.get(timeGroup) ?? -Infinity;
        const groupFurthestEnd = furthestEnd.get(timeGroup) ?? -Infinity;
        const groupFurthestCaption = furthestCaption.get(timeGroup) ?? null;
        if (caption.start < groupPreviousStart - EPSILON) {
          captionFinding(findings, "captions.order", "captions must be sorted by start time", itemPath);
        }
        previousStart.set(timeGroup, caption.start);
        if (caption.start < groupFurthestEnd - EPSILON) {
          addFinding(findings, {
            severity: "error",
            check: "captions.overlap",
            message: `caption overlaps ${groupFurthestCaption.id ?? groupFurthestCaption.path} on the same track`,
            path: itemPath,
            range: { start: caption.start, end: caption.end },
          });
        }
        if (caption.end > groupFurthestEnd) {
          furthestEnd.set(timeGroup, caption.end);
          furthestCaption.set(timeGroup, { id: caption.id, path: itemPath });
        }
      }
      const displaySeconds = caption.end - caption.start;
      if (displaySeconds < 1.0 - EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "captions.short-duration",
          message: `caption display duration is ${displaySeconds.toFixed(2)}s, under the 1.0s readability floor`,
          path: itemPath,
          range: { start: caption.start, end: caption.end },
        });
      }
      if (caption.time_domain === "output" && caption.end > cutsEndSeconds + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "captions.output-domain-exceeds-duration",
          message: `captions[${index}] は time_domain: output の宣言区間が動画総尺 ${cutsEndSeconds.toFixed(1)}s を超えています。書き出しでは ${cutsEndSeconds.toFixed(1)}s までにクランプして表示されます。`,
          path: itemPath,
          range: { start: caption.start, end: caption.end },
        });
      }
      // output-domain cue は既に最終出力軸にあり、source cut への keptOverlap 射影を行わない。
      if (caption.time_domain !== "output") {
        const kept = keptOverlap(caption.start, caption.end, edit?.cuts, caption.src);
        const ratio = kept / (caption.end - caption.start);
        if (ratio < 0.5 - EPSILON) {
          addFinding(findings, {
            severity: "error",
            check: "captions.cut-visibility",
            message: "less than 50% of the caption remains after cuts",
            path: itemPath,
            range: { start: caption.start, end: caption.end },
          });
        }
      }
    }

    const sourceSegment = sourceSegmentIndex(caption.sourceRef);
    if (caption.sourceRef !== null && sourceSegment === null) {
      captionFinding(
        findings,
        "captions.schema",
        "sourceRef must be null or { segment: non-negative integer }",
        itemPath,
      );
    } else if (sourceSegment !== null && Array.isArray(analysis?.transcript)) {
      const transcript = analysis.transcript[sourceSegment];
      if (!isRecord(transcript)) {
        addFinding(findings, {
          severity: "warning",
          check: "captions.edited",
          message: "sourceRef.segment no longer exists in analysis.json",
          path: itemPath,
        });
      } else if (caption.edited === false && caption.text !== transcript.text) {
        captionFinding(
          findings,
          "captions.edited",
          "text differs from its source transcript but edited is false",
          itemPath,
        );
      }
    }

    for (const match of scanRecord(caption, wordBookMatcher)) {
      if (match.matched === match.surface) continue;
      const position = Array.isArray(caption.words) && caption.words.length > 0
        ? `words[${match.index}]`
        : `text offset ${match.index}`;
      if (match.kind === "term") {
        addFinding(findings, {
          severity: caption.edited === true ? "info" : "warning",
          check: "captions.word-book-term",
          message: `${position} に単語帳の表記ゆれ ${JSON.stringify(match.matched)} が残っています（正表記: ${match.surface}）`,
          path: itemPath,
        });
      } else if (match.kind === "notation") {
        addFinding(findings, {
          severity: "warning",
          check: "captions.word-book-notation",
          message: `${position} に非推奨表記 ${JSON.stringify(match.matched)} があります（推奨: ${match.surface}）`,
          path: itemPath,
        });
      }
    }
  }

  if (displayPolicy !== undefined) {
    try {
      const resolved = resolveCaptionDisplay(captionsRoot, captionDisplayEdit(edit), {
        extra_protected_terms: protectedTermsFrom(wordBook.entries),
      });
      for (const fallback of resolved?.word_book_fallbacks ?? []) {
        const index = captions.findIndex(caption => caption?.id === fallback.caption_id);
        addFinding(findings, {
          severity: "warning",
          check: "captions.word-book-break-fallback",
          message: `単語帳の行分割保護を外しました: ${fallback.dropped_terms.join(", ")}`,
          path: index >= 0 ? `captions.json#[${index}]` : captionPath,
        });
      }
    } catch (error) {
      captionFinding(findings, "captions.display-policy", error instanceof Error ? error.message : String(error), captionPath);
    }
  }
}

function validateEmphasisWords(emphasisWords, findings, captionPath) {
  if (!Array.isArray(emphasisWords)) {
    captionFinding(findings, "captions.schema", "emphasis_words must be an array", captionPath);
    return;
  }
  emphasisWords.forEach((item, index) => {
    const itemPath = `${captionPath}#emphasis_words[${index}]`;
    if (!isRecord(item)) {
      captionFinding(findings, "captions.schema", "emphasis word must be an object", itemPath);
      return;
    }
    if (typeof item.id !== "string" || !/^e-\d{4}$/.test(item.id)) {
      captionFinding(
        findings,
        "captions.schema",
        "id must match e- followed by four digits",
        itemPath,
      );
    }
    const timesValid =
      isFiniteNumber(item.t_start) &&
      isFiniteNumber(item.t_end) &&
      item.t_start >= 0 &&
      item.t_end > item.t_start;
    if (!timesValid) {
      captionFinding(
        findings,
        "captions.schema",
        "emphasis word must satisfy 0 <= t_start < t_end",
        itemPath,
      );
    }
    if (!isNonEmptyString(item.word)) {
      captionFinding(findings, "captions.schema", "word must be a non-empty string", itemPath);
    }
    if (!isNonEmptyString(item.emotion)) {
      captionFinding(findings, "captions.schema", "emotion must be a non-empty string", itemPath);
    }
    if (Object.hasOwn(item, "src") && !isNonEmptyString(item.src)) {
      captionFinding(
        findings,
        "captions.schema",
        "src must be a non-empty string when present",
        itemPath,
      );
    }
    if (Object.hasOwn(item, "style_hint") && typeof item.style_hint !== "string") {
      captionFinding(
        findings,
        "captions.schema",
        "style_hint must be a string when present",
        itemPath,
      );
    }
  });
}

function captionDisplayEdit(edit) {
  if (!Array.isArray(edit?.cuts)) return edit;
  let cursor = 0;
  for (const cut of edit.cuts) {
    if (!isRecord(cut) || (cut.track ?? 0) !== 0 || !isFiniteNumber(cut.at)
      || Math.abs(cut.at - cursor) > EPSILON) return edit;
    const overlap = isPositiveNumber(cut.transition_out?.duration) ? cut.transition_out.duration : 0;
    cursor = cut.at + segmentDuration(cut) - overlap;
  }
  const { timeline: _timeline, ...withoutTimeline } = edit;
  return {
    ...withoutTimeline,
    cuts: edit.cuts.map(({ at: _at, track: _track, ...cut }) => cut),
  };
}

const CAPTION_WORD_FIELDS = ["start", "end", "text"];

// caption.words[] は analysis.json の transcriptSegment.words（$defs/word）と同形・同座標系
// （source 秒）。充填パイプライン自体はこの検証の対象外（captions-contract-revision-note.md 参照）
// で、ここは「words が置かれているならその形が正しいか」だけを見る。
function validateCaptionWords(words, caption, findings, itemPath) {
  if (!Array.isArray(words)) {
    captionFinding(findings, "captions.schema", "words must be an array", itemPath);
    return;
  }
  const hasCaptionRange = isFiniteNumber(caption.start) && isFiniteNumber(caption.end);
  words.forEach((word, wordIndex) => {
    const wordPath = `${itemPath}.words[${wordIndex}]`;
    if (!isRecord(word)) {
      captionFinding(findings, "captions.schema", "word must be an object", wordPath);
      return;
    }
    for (const field of CAPTION_WORD_FIELDS) {
      if (!Object.hasOwn(word, field)) {
        captionFinding(findings, "captions.schema", `${field} is required`, wordPath);
      }
    }
    for (const field of Object.keys(word)) {
      if (!CAPTION_WORD_FIELDS.includes(field)) {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 words[]`,
          wordPath,
        );
      }
    }
    const wordTimesValid =
      isFiniteNumber(word.start) &&
      isFiniteNumber(word.end) &&
      word.start >= 0 &&
      word.end >= word.start;
    if (!wordTimesValid) {
      captionFinding(findings, "captions.schema", "word must satisfy 0 <= start <= end", wordPath);
    } else if (
      hasCaptionRange &&
      (word.start < caption.start - EPSILON || word.end > caption.end + EPSILON)
    ) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.words-range",
        message: "word falls outside the caption's [start, end] range",
        path: wordPath,
        range: { start: word.start, end: word.end },
      });
    }
    if (!isNonEmptyString(word.text)) {
      captionFinding(findings, "captions.schema", "text must be a non-empty string", wordPath);
    }
  });
}

const CAPTION_UNRECOGNIZED_FIELDS = ["start", "end"];

function validateCaptionUnrecognized(spans, caption, findings, itemPath) {
  if (!Array.isArray(spans)) {
    captionFinding(findings, "captions.schema", "unrecognized must be an array", itemPath);
    return;
  }
  const hasCaptionRange = isFiniteNumber(caption.start) && isFiniteNumber(caption.end);
  let previous = null;
  spans.forEach((span, spanIndex) => {
    const spanPath = `${itemPath}.unrecognized[${spanIndex}]`;
    if (!isRecord(span)) {
      captionFinding(findings, "captions.schema", "unrecognized span must be an object", spanPath);
      return;
    }
    for (const field of CAPTION_UNRECOGNIZED_FIELDS) {
      if (!Object.hasOwn(span, field)) {
        captionFinding(findings, "captions.schema", `${field} is required`, spanPath);
      }
    }
    for (const field of Object.keys(span)) {
      if (!CAPTION_UNRECOGNIZED_FIELDS.includes(field)) {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 unrecognized[]`,
          spanPath,
        );
      }
    }
    const spanTimesValid = isFiniteNumber(span.start)
      && isFiniteNumber(span.end)
      && span.start >= 0
      && span.end >= span.start;
    if (!spanTimesValid) {
      captionFinding(
        findings,
        "captions.schema",
        "unrecognized span must satisfy 0 <= start <= end",
        spanPath,
      );
      return;
    }
    if (previous && span.start < previous.end) {
      captionFinding(
        findings,
        "captions.schema",
        "unrecognized spans must be sorted by start and not overlap",
        spanPath,
      );
    }
    previous = span;
    if (hasCaptionRange
      && (span.start < caption.start - EPSILON || span.end > caption.end + EPSILON)) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.unrecognized-range",
        message: "unrecognized span falls outside the caption's [start, end] range",
        path: spanPath,
        range: { start: span.start, end: span.end },
      });
    }
    if (Array.isArray(caption.words) && caption.words.some((word) =>
      isRecord(word)
      && isFiniteNumber(word.start)
      && isFiniteNumber(word.end)
      && span.start < word.end
      && span.end > word.start)) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.unrecognized-overlaps-word",
        message: "unrecognized span overlaps a caption word",
        path: spanPath,
        range: { start: span.start, end: span.end },
      });
    }
  });
}

function keptOverlap(start, end, cuts, src) {
  if (!Array.isArray(cuts) || cuts.length === 0) return end - start;
  let overlap = 0;
  for (const cut of cuts) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) continue;
    if (isNonEmptyString(src) && cut.src !== src) continue;
    overlap += Math.max(0, Math.min(end, cut.out) - Math.max(start, cut.in));
  }
  return overlap;
}

function sourceSegmentIndex(sourceRef) {
  if (sourceRef === null) return null;
  if (
    isRecord(sourceRef) &&
    Number.isInteger(sourceRef.segment) &&
    sourceRef.segment >= 0
  ) {
    return sourceRef.segment;
  }
  return null;
}
