import fs from "node:fs/promises";
import path from "node:path";

export const EMPTY_REVIEW_SOURCE = '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n';

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

export async function writeJsonAtomic(destination, value) {
  await writeAtomic(destination, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendAnnotationLine(source, annotation) {
  const closing = /\n([ \t]*)\](\s*\}\s*\n?)$/.exec(source);
  if (!closing) throw new Error("review.json の annotations 配列の閉じ括弧を確認できません");
  const indent = closing[1];
  const itemIndent = `${indent}  `;
  const beforeClosing = source.slice(0, closing.index);
  const isEmpty = /\[\s*$/.test(beforeClosing);
  const serialized = JSON.stringify(annotation);
  const line = isEmpty ? `${itemIndent}${serialized}` : `${itemIndent}, ${serialized}`;
  return `${beforeClosing}\n${line}\n${indent}]${closing[2]}`;
}

export function nextAnnotationNumber(annotations) {
  return annotations.reduce((maximum, annotation) => {
    const match = /^a-(\d{4,})$/.exec(annotation?.id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
}

export function formatAnnotationId(number) {
  return `a-${String(number).padStart(4, "0")}`;
}

export async function appendAnnotationsAtomic(reviewPath, annotations) {
  let source;
  try {
    source = await fs.readFile(reviewPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    source = EMPTY_REVIEW_SOURCE;
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("review.json が有効な JSON ではありません");
  }
  if (!parsed || !Array.isArray(parsed.annotations)) {
    throw new Error("review.json に annotations 配列がありません");
  }

  let nextNumber = nextAnnotationNumber(parsed.annotations);
  let updated = source;
  const assigned = annotations.map((annotation) => {
    const withId = { ...annotation, id: formatAnnotationId(nextNumber) };
    nextNumber += 1;
    updated = appendAnnotationLine(updated, withId);
    return withId;
  });
  if (assigned.length > 0) await writeAtomic(reviewPath, updated);
  return assigned;
}
