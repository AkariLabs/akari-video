#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isMainModule } from "./is-main-module.mjs";

export async function runCli(args, io = console) {
  try {
    const options = parseArguments(args);
    const analysisPath = resolve(options.analysis);
    const captionsPath = resolve(options.captions);
    const [analysisSource, captionsSource] = await Promise.all([
      readFile(analysisPath, "utf8"),
      readFile(captionsPath, "utf8"),
    ]);
    const analysis = parseJson(analysisSource, analysisPath);
    const captions = parseJson(captionsSource, captionsPath);
    if (!Array.isArray(analysis?.transcript)) {
      throw new Error("analysis.json の transcript は配列である必要があります。");
    }
    if (!Array.isArray(captions)) {
      throw new Error("captions.json のルートは配列である必要があります。");
    }

    const transcriptWords = analysis.transcript.flatMap((segment) =>
      Array.isArray(segment?.words) ? segment.words.filter(isCaptionWord) : [],
    );
    const transcriptUnrecognized = analysis.transcript.flatMap((segment) =>
      Array.isArray(segment?.unrecognized) ? segment.unrecognized.filter(isUnrecognizedSpan) : [],
    );
    if (transcriptWords.length === 0 && transcriptUnrecognized.length === 0) {
      io.log("words 0 件・充填対象なし");
      io.log("未認識 0 区間を 0 字幕へ充填");
      return 0;
    }

    let wordsFilled = 0;
    let wordsSkipped = 0;
    let copiedWords = 0;
    let unrecognizedFilled = 0;
    let unrecognizedSkipped = 0;
    let copiedUnrecognized = 0;
    const updated = captions.map((caption) => {
      if (!isCaptionRange(caption)) return caption;
      let next = caption;
      if (transcriptWords.length > 0) {
        const hasExistingWords = Array.isArray(caption.words) && caption.words.length > 0;
        if (!options.force && hasExistingWords) {
          wordsSkipped += 1;
        } else {
          const words = transcriptWords
            .filter((word) => word.start < caption.end && word.end > caption.start)
            .map((word) => ({ ...word }));
          if (words.length > 0) {
            wordsFilled += 1;
            copiedWords += words.length;
            next = { ...next, words };
          }
        }
      }
      if (transcriptUnrecognized.length > 0) {
        const hasExistingUnrecognized = Array.isArray(caption.unrecognized)
          && caption.unrecognized.length > 0;
        if (!options.force && hasExistingUnrecognized) {
          unrecognizedSkipped += 1;
        } else {
          const unrecognized = clipSpansToRange(
            transcriptUnrecognized.filter((span) => span.start < caption.end && span.end > caption.start),
            caption.start,
            caption.end,
          );
          if (unrecognized.length > 0) {
            unrecognizedFilled += 1;
            copiedUnrecognized += unrecognized.length;
            next = { ...next, unrecognized };
          }
        }
      }
      return next;
    });

    if (wordsFilled === 0 && unrecognizedFilled === 0) {
      io.log(`words ${transcriptWords.length} 件・充填対象なし・既存 words ${wordsSkipped} 件をスキップ`);
      io.log(`未認識 0 区間を 0 字幕へ充填・既存 unrecognized ${unrecognizedSkipped} 件をスキップ`);
      return 0;
    }

    const updatedSource = serializeCaptionsForWrite(updated);
    if (options.dryRun) {
      io.log(renderDifference(captionsSource, updatedSource, captionsPath));
    } else {
      await writeFile(captionsPath, updatedSource, "utf8");
    }
    io.log(
      `words ${transcriptWords.length} 件・${copiedWords} 件を ${wordsFilled} 字幕へ充填・既存 words ${wordsSkipped} 件をスキップ${options.dryRun ? "（dry-run）" : ""}`,
    );
    io.log(
      `未認識 ${copiedUnrecognized} 区間を ${unrecognizedFilled} 字幕へ充填・既存 unrecognized ${unrecognizedSkipped} 件をスキップ${options.dryRun ? "（dry-run）" : ""}`,
    );
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function serializeCaptionsForWrite(captions) {
  const rows = captions.map((caption) => `  ${serializeCaptionLine(caption)}`);
  return rows.length > 0 ? `[\n${rows.join(",\n")}\n]\n` : "[]\n";
}

function serializeCaptionLine(caption) {
  const sourceRef = caption.sourceRef === null
    ? "null"
    : `{"segment":${JSON.stringify(caption.sourceRef.segment)}}`;
  const words = caption.words === undefined
    ? ""
    : `,"words":${JSON.stringify(caption.words)}`;
  const unrecognized = caption.unrecognized === undefined
    ? ""
    : `,"unrecognized":${JSON.stringify(caption.unrecognized)}`;
  const style = caption.style === undefined
    ? ""
    : `,"style":${JSON.stringify(caption.style)}`;
  const displayText = caption.display_text === undefined
    ? ""
    : `,"display_text":${JSON.stringify(caption.display_text)}`;
  return `{"id":${JSON.stringify(caption.id)},"start":${JSON.stringify(caption.start)},`
    + `"end":${JSON.stringify(caption.end)},"text":${JSON.stringify(caption.text)},`
    + `"speaker":${caption.speaker === null ? "null" : JSON.stringify(caption.speaker)},`
    + `"sourceRef":${sourceRef},"edited":${caption.edited ? "true" : "false"}${words}${unrecognized}${style}${displayText}}`;
}

function parseArguments(args) {
  const options = { analysis: "", captions: "", dryRun: false, force: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--analysis" || argument === "--captions") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} にファイルを指定してください。`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--force") {
      options.force = true;
    } else {
      throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!options.analysis || !options.captions) {
    throw new Error("使い方: fill-caption-words --analysis <analysis.json> --captions <captions.json> [--dry-run] [--force]");
  }
  return options;
}

function parseJson(source, path) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} を JSON として読み取れません: ${error.message}`);
  }
}

function isCaptionWord(word) {
  return word !== null
    && typeof word === "object"
    && typeof word.start === "number"
    && Number.isFinite(word.start)
    && typeof word.end === "number"
    && Number.isFinite(word.end)
    && word.end > word.start
    && typeof word.text === "string"
    && word.text.length > 0;
}

function isCaptionRange(caption) {
  return caption !== null
    && typeof caption === "object"
    && typeof caption.start === "number"
    && Number.isFinite(caption.start)
    && typeof caption.end === "number"
    && Number.isFinite(caption.end)
    && caption.end > caption.start;
}

function isUnrecognizedSpan(span) {
  return span !== null
    && typeof span === "object"
    && typeof span.start === "number"
    && Number.isFinite(span.start)
    && typeof span.end === "number"
    && Number.isFinite(span.end)
    && span.end > span.start;
}

function clipSpansToRange(spans, start, end) {
  const rangeStart = roundMs(Number(start));
  const rangeEnd = roundMs(Number(end));
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return [];
  const clipped = (Array.isArray(spans) ? spans : []).flatMap((span) => {
    const clippedStart = roundMs(Math.max(rangeStart, Number(span?.start)));
    const clippedEnd = roundMs(Math.min(rangeEnd, Number(span?.end)));
    return Number.isFinite(clippedStart) && Number.isFinite(clippedEnd) && clippedEnd > clippedStart
      ? [{ start: clippedStart, end: clippedEnd }]
      : [];
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const span of clipped) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = roundMs(Math.max(previous.end, span.end));
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

function renderDifference(before, after, captionsPath) {
  if (before === after) return "差分なし";
  const beforeLines = before.replace(/\n$/u, "").split("\n");
  const afterLines = after.replace(/\n$/u, "").split("\n");
  return [
    `--- ${captionsPath}`,
    `+++ ${captionsPath} (words filled)`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
