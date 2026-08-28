import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { hashDeclaredRenderInputs } from "./render-inputs.mjs";

export const ABSENT_REVIEW_SENTINEL = "AKARI_REVIEW_ABSENT/v1";
export const ABSENT_LINT_SENTINEL = "AKARI_LINT_ABSENT/v1";
export const GPU_CAPTION_RECEIPT_MODES = Object.freeze(["sprite", "words-native"]);

export function normalizeGpuCaptionReceiptEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item.id !== "string" || !GPU_CAPTION_RECEIPT_MODES.includes(item.mode)) {
      throw new Error("GPU caption receipt requires an id and sprite|words-native mode");
    }
    const integer = (name) => {
      const number = Number(item[name]);
      if (!Number.isInteger(number) || number < 0) throw new Error(`GPU caption receipt ${name} must be a non-negative integer`);
      return number;
    };
    return {
      id: item.id,
      mode: item.mode,
      style: typeof item.style === "string" ? item.style : null,
      units: integer("units"),
      words: integer("words"),
      rasters: integer("rasters"),
      tiles: integer("tiles"),
    };
  });
}

export async function createImmutableRenderReceipt({
  projectRoot,
  declaredInputs,
  inputSnapshot,
  outputPath,
  ffprobe,
  plan,
  verify,
  tools,
  captionLayout = null,
  audioQc = null,
  createdAt = new Date().toISOString(),
}) {
  if (verify?.verdict !== "pass") throw new Error("render receipt requires verify.verdict pass");
  if (!Array.isArray(inputSnapshot) || inputSnapshot.length === 0) {
    throw new Error("render receipt requires the initial declared-input snapshot");
  }
  const root = await realpath(resolve(projectRoot));
  const lintPath = join(root, ".akari", "lint.json");
  const reviewPath = join(root, "review.json");
  const lint = await optionalFileHash(lintPath, ABSENT_LINT_SENTINEL);
  const review = await optionalFileHash(reviewPath, ABSENT_REVIEW_SENTINEL);
  const actualOutputPath = await realpath(outputPath);
  const outputInfo = await stat(actualOutputPath);
  if (!outputInfo.isFile() || !isWithin(root, actualOutputPath)) {
    throw new Error("render output is not a regular contained project file");
  }

  const payload = {
    version: 1,
    receipt_scope: "akari-declared-render-inputs/v1",
    createdAt,
    inputs: inputSnapshot,
    output: {
      path: relative(root, actualOutputPath),
      bytes: outputInfo.size,
      sha256: await sha256File(actualOutputPath),
      ffprobe,
    },
    plan_sha256: sha256(canonicalJson(plan)),
    lint_sha256: lint.sha256,
    ...(lint.exists ? {} : { lint_state: "absent" }),
    review_sha256: review.sha256,
    review_state: review.exists ? "present" : "absent",
    verify: { verdict: "pass" },
    tools,
    ...(captionLayout ? { caption_layout: captionLayout } : {}),
    ...(audioQc ? { audio_qc: audioQc } : {}),
  };
  const bytes = `${JSON.stringify(payload, null, 2)}\n`;
  const digest = sha256(bytes);
  const receiptDirectory = await prepareContainedReportDirectory(root, "render-receipts");
  const currentSnapshot = await hashDeclaredRenderInputs(declaredInputs);
  const changes = findSnapshotDifferences(inputSnapshot, currentSnapshot);
  if (changes.length > 0 && !await isOnlyUnreferencedSourceDifference({
    changes,
    declaredInputs,
  })) {
    throw new Error(`render inputs changed during rendering: ${changes[0]}`);
  }
  await assertContainedDirectory(root, receiptDirectory, ".akari/reports/render-receipts");
  const receiptPath = join(receiptDirectory, `${digest}.json`);
  try {
    await writeFile(receiptPath, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(receiptPath, "utf8");
    if (existing !== bytes) throw new Error(`immutable render receipt collision at ${relative(root, receiptPath)}`);
  }
  return { payload, path: relative(root, receiptPath), sha256: digest };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function optionalFileHash(path, absentSentinel) {
  try {
    return { exists: true, sha256: await sha256File(path) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, sha256: sha256(absentSentinel) };
    throw error;
  }
}

export async function prepareContainedReportDirectory(projectRoot, childName) {
  if (typeof childName !== "string" || childName === "" || childName.includes("/") || childName.includes("\\")) {
    throw new Error("report directory child name must be one path segment");
  }
  const root = await realpath(resolve(projectRoot));
  const akariDirectory = join(root, ".akari");
  await assertContainedDirectory(root, akariDirectory, ".akari");
  const reportsDirectory = await ensureContainedChild(root, akariDirectory, "reports");
  return ensureContainedChild(root, reportsDirectory, childName);
}

async function ensureContainedChild(root, parent, name) {
  await assertContainedDirectory(root, parent, relative(root, parent));
  const directory = join(parent, name);
  try {
    await mkdir(directory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertContainedDirectory(root, directory, relative(root, directory));
  return realpath(directory);
}

async function assertContainedDirectory(root, directory, label) {
  let info;
  let actual;
  try {
    info = await lstat(directory);
    actual = await realpath(directory);
  } catch (error) {
    throw new Error(`${label} is not a regular project directory: ${messageOf(error)}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink() || !isWithin(root, actual)) {
    throw new Error(`${label} is not a regular contained project directory`);
  }
}

function findSnapshotDifferences(initial, current) {
  const changes = [];
  const length = Math.max(initial.length, current.length);
  for (let index = 0; index < length; index += 1) {
    if (canonicalJson(initial[index]) !== canonicalJson(current[index])) {
      const entry = current[index] ?? initial[index];
      changes.push(`${entry?.role ?? "unknown"}:${entry?.path ?? "unknown"}`);
    }
  }
  return changes;
}

async function isOnlyUnreferencedSourceDifference({ changes, declaredInputs }) {
  if (changes.length !== 1) return false;
  const editInput = declaredInputs.find((input) => input?.role === "edit");
  if (changes[0] !== `edit:${editInput?.path ?? "unknown"}`
      || typeof editInput?.text !== "string") return false;

  try {
    // cuts から未参照の source は本レンダが消費した入力ではなく、同時レンダの成果物登録だけを除外する。
    const consumed = JSON.parse(editInput.text);
    const current = JSON.parse(await readFile(editInput.lexical_path ?? editInput.absolute_path, "utf8"));
    if (!Array.isArray(consumed?.sources) || !Array.isArray(current?.sources)) return false;
    return canonicalJson(withoutUnreferencedSources(consumed))
      === canonicalJson(withoutUnreferencedSources(current));
  } catch {
    return false;
  }
}

function withoutUnreferencedSources(edit) {
  const referenced = new Set((edit.cuts ?? []).map((cut) => cut?.src));
  return {
    ...edit,
    sources: edit.sources.filter((source) => referenced.has(source?.id)),
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
