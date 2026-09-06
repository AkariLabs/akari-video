import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

function tableCells(line) {
  const text = line.trim();
  if (!text.startsWith("|") || !text.endsWith("|")) return null;
  const cells = text.slice(1, -1).split("|").map((cell) => cell.trim());
  return cells.length >= 7 ? cells : null;
}

export function parseDecisionLogRows(text) {
  return text.split(/\r?\n/u).flatMap((line) => {
    const cells = tableCells(line);
    if (!cells || cells.includes("日時") || cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) return [];
    return [{ line, cells }];
  });
}

export function findProposals(rows) {
  return rows.filter(({ cells }) => cells.includes("proposal") && cells.includes("machine:director"))
    .map((row) => ({ ...row, subject: row.cells[2], sha: /sha:([0-9a-f]{8})(?![0-9a-f])/u.exec(row.cells.at(-1))?.[1] }));
}

export function findSettled(rows) {
  return new Set(rows.filter(({ cells }) => cells[1] === "result").map(({ cells }) => cells[2]));
}

function canonicalJSON(value) {
  const sortKeys = (entry) => {
    if (Array.isArray(entry)) return entry.map(sortKeys);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sortKeys(entry[key])]));
    }
    return entry;
  };
  return JSON.stringify(sortKeys(value));
}

export function collectIds({ edit, captions }) {
  const ids = new Map();
  const add = (record) => {
    if (typeof record?.id === "string") ids.set(record.id, canonicalJSON(record));
  };
  const visit = (items) => {
    for (const item of items ?? []) {
      add(item);
      if (item.source?.kind === "group") visit(item.items);
    }
  };
  for (const track of edit?.tracks ?? []) visit(track.items);
  for (const record of (Array.isArray(captions) ? captions : captions?.captions) ?? []) add(record);
  return ids;
}

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

// dryRun shares all reads and classification with the append path.
export async function settleDecisionLog({ projectRoot, actor = "machine:render-cut", now = new Date(), dryRun = false }) {
  const path = join(projectRoot, "decision-log.md");
  const text = await readOptional(path);
  if (text === undefined) return { settled: 0 };
  const rows = parseDecisionLogRows(text);
  const settled = findSettled(rows);
  const proposals = findProposals(rows).filter(({ subject }) => !settled.has(subject));
  if (!proposals.length) return { settled: 0, results: [] };
  const [editText, captionsText] = await Promise.all([
    readOptional(join(projectRoot, "edit.json")), readOptional(join(projectRoot, "captions.json")),
  ]);
  const ids = collectIds({
    edit: editText === undefined ? undefined : JSON.parse(editText),
    captions: captionsText === undefined ? undefined : JSON.parse(captionsText),
  });
  const results = [];
  const lines = [];
  if (/[|\r\n]/u.test(actor)) throw new Error("actor に縦棒・改行は使えません");
  for (const proposal of proposals) {
    const { subject, sha, cells } = proposal;
    if (settled.has(subject)) continue;
    const current = ids.get(subject);
    const result = current === undefined ? "消えた" : !sha || createHash("sha256").update(current).digest("hex").slice(0, 8) === sha ? "残った" : "直した";
    results.push({ subject, result });
    lines.push(`| ${now.toISOString()} | result | ${subject} | ${result} | 書き出し時に帳面と edit.json / captions.json を照合 | ${actor} | ${cells.at(-1)} |`);
    settled.add(subject);
  }
  if (!dryRun && lines.length) {
    let suffix = text.endsWith("\n") || !text.length ? "" : "\n";
    const lastLine = text.replace(/\r?\n$/u, "").split(/\r?\n/u).at(-1);
    if (!tableCells(lastLine)) suffix += "\n| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |\n|---|---|---|---|---|---|---|\n";
    await appendFile(path, `${suffix}${lines.join("\n")}\n`, "utf8");
  }
  return { settled: results.length, results };
}
