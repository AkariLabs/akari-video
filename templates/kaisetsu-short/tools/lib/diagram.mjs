// 図解スペック（script.json の beat.diagram）を、文アンカーを絶対秒に解決した
// 「レンダー可能な形」に変換する。
//
// 入力スキーマ（script.json 側・可変層）:
//   beat.diagram = {
//     align?: "start" | "center",     // .dg コンテナの justify-content（b7 は "center"）
//     blocks: [ Block, ... ],         // layout "stack"（既定）: 単一グループを縦積み
//     groups?: [ { id, blocks:[Block,...] }, ... ],  // layout "crossfade" 用（b2 のみ使用）
//     crossfade?: { at: Anchor, dur: number }        // groups[0] -> groups[1] の切替
//   }
//   Anchor = { sentence: number, offset?: number }
//   Block（共通）= { id, type, reveal？: {at:Anchor, dur?}, fadeOut?: {at:Anchor, dur?},
//                    collapseWhenHidden?: bool, preRevealOpacity?: number, display?: string,
//                    ...type固有フィールド }
//
// 型ごとの固有フィールド（v3 の b2〜b7 を再現する最小語彙・タスク契約 §設計指示1 準拠）:
//   eyebrow      { text }
//   tier-ladder  { rows: [{ variant: "small"|"medium"|"large"|"highlight", text, tag?, reveal?, preRevealOpacity? }] }
//                // variant は段階サイズの汎用語彙のみ（動画固有の名前はここに持ち込まない）。
//                // tag は highlight 行のみ対応（右上のバブル注記）
//   date-badge   { text }
//   dg-note      { text }
//   shot-card    { frames: [{ src, width, height, at?:Anchor }] }  // frames[0] は常時最初のソース
//   view-badge   { text }
//   note-strip   { text, position?: "flow" | "absolute-bottom" }
//   mini-timeline{ nodes: [{ label, state:"neutral"|"bad"|"good" }] }
//   big-emph     { texts: [{ text, at?:Anchor }] }                 // texts[0] が既定表示
//   vs-card      { left:{title,desc}, right:{title,desc}, bridge }
//   cond-row     { tag:{text,outline?}, desc }
//   bullet-row   { text }
//   disclaimer   { text, position?: "bottom-right" }
//
// 出力（timeline.json に焼き込む解決済み形）: 上記と同じ木構造だが、Anchor はすべて
// 絶対秒の数値 `t` に置き換わる（`{sentence,offset}` -> `t: 12.753` 等）。

import { resolveAnchor, round3 } from "./anchors.mjs";

function resolveReveal(reveal, sentences) {
  if (!reveal) return null;
  return { t: resolveAnchor(reveal.at, sentences), dur: reveal.dur != null ? reveal.dur : 0.4 };
}

function resolveFrames(frames, sentences) {
  return frames.map((f, i) => ({
    src: f.src,
    width: f.width,
    height: f.height,
    t: i === 0 ? null : resolveAnchor(f.at, sentences),
  }));
}

function resolveBlock(block, sentences) {
  const out = {
    id: block.id,
    type: block.type,
    display: block.display || null,
    collapseWhenHidden: !!block.collapseWhenHidden,
    preRevealOpacity: block.preRevealOpacity != null ? block.preRevealOpacity : 0,
    reveal: resolveReveal(block.reveal, sentences),
    fadeOut: resolveReveal(block.fadeOut, sentences),
  };
  switch (block.type) {
    case "eyebrow":
    case "date-badge":
    case "dg-note":
    case "view-badge":
    case "note-strip":
    case "disclaimer":
    case "bullet-row":
      out.text = block.text;
      if (block.position) out.position = block.position;
      if (block.mark) out.mark = block.mark;
      break;
    case "tier-ladder":
      out.rows = block.rows.map((r) => {
        if (!["small", "medium", "large", "highlight"].includes(r.variant)) {
          throw new Error(`tier-ladder row.variant は small/medium/large/highlight のいずれか必要（受け取った値: ${r.variant}）`);
        }
        return {
          variant: r.variant,
          text: r.text,
          tag: r.tag || null,
          reveal: resolveReveal(r.reveal, sentences),
          preRevealOpacity: r.preRevealOpacity != null ? r.preRevealOpacity : 0,
        };
      });
      break;
    case "shot-card":
      out.frames = resolveFrames(block.frames, sentences);
      break;
    case "mini-timeline":
      out.nodes = block.nodes;
      break;
    case "big-emph":
      out.texts = block.texts.map((tx, i) => ({ text: tx.text, t: i === 0 ? null : resolveAnchor(tx.at, sentences) }));
      break;
    case "vs-card":
      out.left = block.left;
      out.right = block.right;
      out.bridge = block.bridge;
      break;
    case "cond-row":
      out.tag = block.tag;
      out.desc = block.desc;
      break;
    default:
      throw new Error(`未知の diagram block type: ${block.type}`);
  }
  return out;
}

export function resolveDiagram(diagram, sentences) {
  if (!diagram) return null;
  const out = { align: diagram.align || "start" };
  if (diagram.gap != null) out.gap = diagram.gap;
  if (diagram.stackTop != null) out.stackTop = diagram.stackTop;
  if (diagram.eyebrow) {
    out.eyebrow = { text: diagram.eyebrow.text, reveal: resolveReveal(diagram.eyebrow.reveal, sentences) };
  }
  if (diagram.groups) {
    out.groups = diagram.groups.map((g) => ({ id: g.id, blocks: g.blocks.map((b) => resolveBlock(b, sentences)) }));
    out.crossfade = diagram.crossfade
      ? { t: resolveAnchor(diagram.crossfade.at, sentences), dur: diagram.crossfade.dur != null ? diagram.crossfade.dur : 0.5 }
      : null;
  } else {
    out.blocks = (diagram.blocks || []).map((b) => resolveBlock(b, sentences));
  }
  return out;
}
