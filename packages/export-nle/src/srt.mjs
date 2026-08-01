// captions.json → SRT サイドカー。全 NLE（FCP / Premiere / Resolve / CapCut）が読める
// 最小公倍数の字幕交換。captions の start/end は (src, source 秒) アンカーなので、
// render-cut と同じ写像（xfade 重複込みの逐次連結）で timeline 秒へ落としてから書く。
// スタイル（text_style / style / emphasis）は SRT に表現がなく落ちる（dropped で明示）。

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { srtTime } from "./time.mjs";
import { sourceRangeToTimelineRanges } from "./edit-model.mjs";

export function loadCaptions(projectRoot) {
  const path = resolve(projectRoot, "captions.json");
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.captions ?? [];
}

export function buildSrt(model, captions) {
  const warnings = [...model.warnings];
  const dropped = [];
  if (captions.some((caption) => caption.style || caption.text_style || caption.words)) {
    dropped.push({
      field: "captions[].style / text_style / words",
      reason: "SRT はプレーンテキストのみ。カラオケ演出・座布団・語タイミングは落ちる",
      hint: "見た目込みが必要なら AKARI レンダ（焼き込み）を使う",
    });
  }
  const cues = [];
  for (const caption of captions) {
    const source = typeof caption.src === "string" && caption.src !== "" ? caption.src : null;
    if (source === null && model.sources.length > 1) {
      warnings.push(`captions.json ${caption.id ?? "(unknown)"} はマルチソース編集で src がないためスキップ`);
      continue;
    }
    const text = typeof caption.display_text === "string" ? caption.display_text : caption.text;
    for (const range of sourceRangeToTimelineRanges(caption.start, caption.end, model.cuts, source)) {
      if (range.duration <= 0) continue;
      cues.push({ start: range.start, end: range.start + range.duration, text });
    }
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const body = cues
    .map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`)
    .join("\n\n");
  return { srt: body.length > 0 ? `${body}\n` : "", cueCount: cues.length, dropped, warnings };
}
