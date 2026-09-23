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

// All review.json writers use the same empty directory lock.
export async function withReviewLock(reviewPath, operation) {
  const lockPath = `${reviewPath}.lock`;
  await fs.mkdir(path.dirname(reviewPath), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = await fs.stat(lockPath);
        if (Date.now() - lock.mtimeMs > 60_000) {
          await fs.rmdir(lockPath);
          continue;
        }
      } catch (inspectError) {
        if (inspectError?.code !== "ENOENT") throw inspectError;
        continue;
      }
      if (attempt >= 1200) {
        throw new Error(`review.json は別の処理が書き込み中です（${lockPath}）`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.rmdir(lockPath);
  }
}

export async function maximumRecordedAnnotationNumber(projectRoot) {
  let maximum = 0;
  for (const [directory, manifestName] of [
    [path.join(projectRoot, "review", "sessions"), "session.json"],
    [path.join(projectRoot, "review", "canvas"), "canvas.json"],
  ]) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(directory, entry.name, manifestName);
      let source;
      try {
        source = await fs.readFile(sessionPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const session = JSON.parse(source);
      if (session.compiledAnnotations != null && !Array.isArray(session.compiledAnnotations)) {
        throw new Error(`${sessionPath} の compiledAnnotations が配列ではありません`);
      }
      for (const id of session.compiledAnnotations ?? []) {
        const match = /^a-(\d{4,})$/.exec(id);
        if (match) maximum = Math.max(maximum, Number(match[1]));
      }
    }
  }
  return maximum;
}

export async function appendAnnotationsAtomic(reviewPath, annotations) {
  return withReviewLock(reviewPath, async () => {
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

    let nextNumber = Math.max(
      nextAnnotationNumber(parsed.annotations),
      (await maximumRecordedAnnotationNumber(path.dirname(reviewPath))) + 1,
    );
    let updated = source;
    const assigned = annotations.map((annotation) => {
      const withId = { ...annotation, id: formatAnnotationId(nextNumber) };
      nextNumber += 1;
      updated = appendAnnotationLine(updated, withId);
      return withId;
    });
    if (assigned.length > 0) await writeAtomic(reviewPath, updated);
    return assigned;
  });
}
