import { resolveUtteranceReference } from "./time-mapping.mjs";

function joinText(parts) {
  return parts.reduce((result, part) => {
    const text = String(part ?? "").trim();
    if (!text) return result;
    if (!result) return text;
    const needsSpace = /[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(text);
    return `${result}${needsSpace ? " " : ""}${text}`;
  }, "");
}

function makeUtterance(words, fallback) {
  const validWords = words.filter((word) => (
    Number.isFinite(word?.start)
    && Number.isFinite(word?.end)
    && word.end > word.start
    && String(word?.text ?? "").trim()
  ));
  if (validWords.length === 0) {
    return {
      text: String(fallback.text ?? "").trim(),
      recT: [fallback.start, fallback.end],
      words: [],
    };
  }
  return {
    text: joinText(validWords.map((word) => word.text)),
    recT: [validWords[0].start, validWords.at(-1).end],
    words: validWords,
  };
}

export function segmentUtterances(segments, mergeGapSeconds = 0.3) {
  const sorted = [...segments]
    .filter((segment) => (
      Number.isFinite(segment?.start)
      && Number.isFinite(segment?.end)
      && segment.end > segment.start
      && String(segment?.text ?? "").trim()
    ))
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const segment of sorted) {
    const normalized = {
      start: segment.start,
      end: segment.end,
      text: String(segment.text).trim(),
      words: Array.isArray(segment.words) ? [...segment.words].sort((a, b) => a.start - b.start) : [],
    };
    const previous = merged.at(-1);
    if (previous && normalized.start - previous.end < mergeGapSeconds) {
      previous.end = Math.max(previous.end, normalized.end);
      previous.text = joinText([previous.text, normalized.text]);
      previous.words.push(...normalized.words);
    } else {
      merged.push(normalized);
    }
  }

  const utterances = [];
  for (const segment of merged) {
    if (segment.words.length === 0) {
      utterances.push(makeUtterance([], segment));
      continue;
    }
    const chunks = [];
    let current = [];
    for (let index = 0; index < segment.words.length; index += 1) {
      const word = segment.words[index];
      current.push(word);
      const hasMore = index < segment.words.length - 1;
      if (hasMore && /[。！？!?]/.test(String(word.text ?? ""))) {
        chunks.push(current);
        current = [];
      }
    }
    if (current.length > 0) chunks.push(current);
    if (chunks.length === 1) {
      utterances.push({
        ...makeUtterance(chunks[0], segment),
        // backend の segment 原文はゼロ幅 token を落とした words 結合より忠実。
        text: segment.text,
      });
    } else {
      for (const chunk of chunks) utterances.push(makeUtterance(chunk, segment));
    }
  }
  return utterances.filter((utterance) => utterance.text);
}

const DISCARD_PATTERNS = [
  { pattern: /音声\s*チェック|マイク\s*チェック/, reason: "システム動作確認であり編集指示ではない" },
  { pattern: /これは\s*テスト|テストです/, reason: "テスト発話であり編集指示ではない" },
  { pattern: /独り言|雑談/, reason: "独り言・雑談であり編集指示ではない" },
];

const EDITING_TERMS = /テロップ|字幕|文字|カット|削除|場面|シーン|切り替え|タイミング|BGM|背景の音楽|音量|大き|小さ|静か|調整|短く|長く|明る|暗く|色|クロップ|ズーム|効果音|ナレーション/;
const REQUEST_TERMS = /して|ほしい|ください|下げ|上げ|削除|カット|調整|変え|直し|大き|小さ/;

export function provisionalJudgement(transcript) {
  const text = String(transcript ?? "").replace(/\s+/g, " ").trim();
  const discard = DISCARD_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (discard && !EDITING_TERMS.test(text.replace(discard.pattern, ""))) {
    return { action: "discard", reason: discard.reason, text: null, confidence: "high" };
  }

  let normalized = null;
  if (/テロップ|字幕/.test(text) && /文字|大き|拡大/.test(text)) {
    normalized = "テロップの文字を大きくする";
  } else if (/カット|場面|シーン/.test(text) && /削除|カットして/.test(text)) {
    normalized = "このカットを削除する";
  } else if (/シーン\s*切り替え|切り替え/.test(text) && /タイミング|調整/.test(text)) {
    normalized = "シーン切り替えのタイミングを調整する";
  } else if (/BGM|背景の音楽|音楽/.test(text) && /静か|音量|下げ/.test(text)) {
    normalized = "BGMの音量を下げる";
  } else if (EDITING_TERMS.test(text) && REQUEST_TERMS.test(text)) {
    normalized = text
      .replace(/してください[。.!！?？]?$/, "する")
      .replace(/してほしい[。.!！?？]?$/, "する")
      .replace(/して欲しい[。.!！?？]?$/, "する")
      .replace(/[。.!！?？]+$/, "");
  }

  if (normalized) {
    return { action: "annotate", reason: "編集対象と変更要求を含む", text: normalized, confidence: "high" };
  }
  return {
    action: "annotate",
    reason: "編集指示か否か、または命令形への正規化に確信がない",
    text: text || "発話内容を確認する",
    confidence: "low",
  };
}

function confirmationText(normalizedText, reference, judgement) {
  const candidateText = reference.candidates.length > 0
    ? `候補 timelineT: ${reference.candidates.map((value) => value.toFixed(3)).join(", ")}`
    : `暫定位置 timelineT: ${reference.timelineT.toFixed(3)}`;
  const reason = judgement.confidence === "low" ? judgement.reason : "参照先が一意に決まらない";
  return `[要確認] ${normalizedText}（${candidateText}。${reason}ため、この対象でよいか確認してください）`;
}

export function buildProposals({ utterances, trace, cutMap }) {
  return utterances.map((utterance, index) => {
    const reference = resolveUtteranceReference({ utterance, trace, cutMap });
    const provisional = provisionalJudgement(utterance.text);
    return {
      index,
      transcript: utterance.text,
      recRange: utterance.recT,
      reference,
      provisional,
      decision: null,
    };
  });
}

export function chooseProposalDecision(proposal) {
  const decision = proposal.decision && typeof proposal.decision === "object"
    ? proposal.decision
    : proposal.provisional;
  const action = decision.action === "discard" ? "discard" : "annotate";
  const confidence = decision.confidence === "low" ? "low" : (
    proposal.reference.confidence === "low" ? "low" : "high"
  );
  return {
    action,
    reason: String(decision.reason ?? proposal.provisional.reason ?? "理由未記入"),
    text: action === "annotate"
      ? String(decision.text ?? proposal.provisional.text ?? proposal.transcript).trim()
      : null,
    confidence,
  };
}

export function proposalToAnnotation({ proposal, decision, sessionId, audioPath, createdAt }) {
  const needsConfirmation = decision.confidence === "low" || proposal.reference.confidence === "low";
  return {
    createdAt,
    sourceT: proposal.reference.sourceT,
    sourceRange: proposal.reference.sourceRange,
    timelineT: proposal.reference.timelineT,
    target: proposal.reference.target,
    text: needsConfirmation
      ? confirmationText(decision.text, proposal.reference, decision)
      : decision.text,
    input: "session",
    audio: audioPath,
    strokes: null,
    poses: null,
    status: "open",
    response: null,
    transcript: proposal.transcript,
    session: {
      id: sessionId,
      recRange: proposal.recRange,
      confidence: needsConfirmation ? "low" : "high",
    },
  };
}
