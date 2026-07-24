import fs from "node:fs/promises";
import path from "node:path";

export const KNOWN_STATUSES = ["open", "addressed", "resolved"];
export const KNOWN_ACTIONS = ["edited", "declined"];

export async function writeAtomic(destination, source) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, source);
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readReviewSource(reviewPath) {
  try {
    return await fs.readFile(reviewPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function findAnnotationsArrayStart(source) {
  const match = /"annotations"\s*:\s*\[/.exec(source);
  if (!match) throw new Error("review.json に annotations 配列が見つかりません");
  return match.index + match[0].length;
}

// annotations 配列の各要素（常に JSON オブジェクト）の [start, end) をテキスト走査で特定する。
// 文字列中の { } [ ] やエスケープを誤検出しないよう、文字列内はスキップする。
// 対象要素だけを丸ごと置換するための座標として使う（他要素のバイト列には一切触れない）。
function splitObjectArrayElements(source, arrayContentStart) {
  const elements = [];
  let depth = 0;
  let elementStart = null;
  let inString = false;
  let arrayEnd = null;
  for (let index = arrayContentStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === "\\") { index += 1; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      depth += 1;
      if (depth === 1) elementStart = index;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && elementStart !== null) {
        elements.push({ start: elementStart, end: index + 1 });
        elementStart = null;
      }
      continue;
    }
    if (char === "]" && depth === 0 && elementStart === null) {
      arrayEnd = index;
      break;
    }
  }
  if (arrayEnd === null) throw new Error("review.json の annotations 配列の閉じ括弧が見つかりません");
  return elements;
}

export function locateAnnotations(source) {
  const start = findAnnotationsArrayStart(source);
  return splitObjectArrayElements(source, start).map(({ start: elementStart, end: elementEnd }) => {
    const raw = source.slice(elementStart, elementEnd);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`review.json の annotation を JSON として解釈できません: ${raw.slice(0, 60)}...`);
    }
    return { start: elementStart, end: elementEnd, raw, value };
  });
}

export function parseReviewDocument(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("review.json が有効な JSON ではありません");
  }
  if (!parsed || !Array.isArray(parsed.annotations)) {
    throw new Error("review.json に annotations 配列がありません");
  }
  return parsed;
}

export function needsConfirmation(annotation) {
  return typeof annotation?.text === "string" && annotation.text.trimStart().startsWith("[要確認]");
}

function lineIndent(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, index));
  return match ? match[0] : "";
}

function serializeResponseValue(text, keyIndex, response) {
  // 契約の response 例（contract-2026-07-15 §3）と同じキー順で固定する。呼び出し側の
  // オブジェクトプロパティ順に依らせない（JSON.stringify はプロパティ挿入順に従うため）。
  const canonical = { summary: response.summary, action: response.action, respondedAt: response.respondedAt };
  const isMultiline = text.includes("\n");
  if (!isMultiline) return JSON.stringify(canonical);
  const indent = lineIndent(text, keyIndex);
  const innerIndent = `${indent}  `;
  return [
    "{",
    `${innerIndent}"summary": ${JSON.stringify(response.summary)},`,
    `${innerIndent}"action": ${JSON.stringify(response.action)},`,
    `${innerIndent}"respondedAt": ${JSON.stringify(response.respondedAt)}`,
    `${indent}}`,
  ].join("\n");
}

// 対象 annotation の生テキストのうち "status" と "response" の値だけを差し替える。
// 他のキー（id / createdAt / sourceT / text / session / strokes 等）の文字列表現には一切触れない
// ため、対象 annotation の他フィールドと、他の annotation は常にバイト不変になる。
export function spliceResponseIntoAnnotation(raw, { action, summary, respondedAt }) {
  const statusMatch = /("status"\s*:\s*")open(")/.exec(raw);
  if (!statusMatch) {
    throw new Error('対象 annotation に "status": "open" が見つかりません（想定外の形式です）');
  }
  const afterStatus = `${raw.slice(0, statusMatch.index)}${statusMatch[1]}addressed${statusMatch[2]}${raw.slice(statusMatch.index + statusMatch[0].length)}`;

  const responseMatch = /("response"\s*:\s*)null\b/.exec(afterStatus);
  if (!responseMatch) {
    throw new Error('対象 annotation に "response": null が見つかりません（既に応答済みの可能性があります）');
  }
  const serialized = serializeResponseValue(afterStatus, responseMatch.index, { action, summary, respondedAt });
  return (
    afterStatus.slice(0, responseMatch.index)
    + responseMatch[1]
    + serialized
    + afterStatus.slice(responseMatch.index + responseMatch[0].length)
  );
}

// open → addressed の状態遷移を原子的に執行する。ガードに 1 つでも引っかかれば
// review.json は一切書き換えない（呼び出し側は ok:false の code/reason で理由を判別する）。
export async function respondToAnnotation(reviewPath, { id, action, summary, respondedAt }) {
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, code: "invalid-id", reason: "id が指定されていません" };
  }
  if (!KNOWN_ACTIONS.includes(action)) {
    return { ok: false, code: "invalid-action", reason: `action は ${KNOWN_ACTIONS.join(" / ")} のいずれかを指定してください` };
  }
  if (typeof summary !== "string" || !summary.trim()) {
    return { ok: false, code: "missing-summary", reason: "summary は必須です（黙殺・空文字は不可）" };
  }
  if (typeof respondedAt !== "string" || !respondedAt.trim()) {
    return { ok: false, code: "invalid-responded-at", reason: "respondedAt が不正です" };
  }

  const source = await readReviewSource(reviewPath);
  if (source === null) {
    return { ok: false, code: "no-review", reason: "review.json がありません" };
  }

  let elements;
  try {
    elements = locateAnnotations(source);
  } catch (error) {
    return { ok: false, code: "malformed", reason: error instanceof Error ? error.message : String(error) };
  }

  const target = elements.find((element) => element.value?.id === id);
  if (!target) {
    return { ok: false, code: "unknown-id", reason: `未知の id です: ${id}` };
  }
  if (target.value.status !== "open") {
    return {
      ok: false,
      code: "not-open",
      reason: `status が "open" ではないため対応できません（現在: "${target.value.status}"）。open のみ addressed へ遷移できます`,
    };
  }

  let updatedRaw;
  try {
    updatedRaw = spliceResponseIntoAnnotation(target.raw, { action, summary, respondedAt });
  } catch (error) {
    return { ok: false, code: "malformed", reason: error instanceof Error ? error.message : String(error) };
  }
  const updatedSource = `${source.slice(0, target.start)}${updatedRaw}${source.slice(target.end)}`;

  // 全体が依然として有効な JSON であることをディスクへ書く前に確認する（自己防御。
  // 通常は起きないが、想定外の入力で splice が壊れた場合に review.json を汚さない）。
  let updatedAnnotation;
  try {
    const parsedDocument = parseReviewDocument(updatedSource);
    updatedAnnotation = parsedDocument.annotations.find((annotation) => annotation.id === id);
  } catch (error) {
    return { ok: false, code: "malformed", reason: error instanceof Error ? error.message : String(error) };
  }

  await writeAtomic(reviewPath, updatedSource);
  return { ok: true, annotation: updatedAnnotation };
}
