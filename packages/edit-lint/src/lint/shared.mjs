import { constants as fsConstants, statSync } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { resolveLibraryFallback } from "../library-reference.mjs";

export const EPSILON = 1e-6;

export class ExecutionError extends Error {}

/** item が要求する素材終端（秒）。out が無ければフレーム尺と speed から導く。 */
export function effectiveSourceOut(item, fps) {
  const source = item?.source;
  const inSeconds = isFiniteNumber(source?.in) ? source.in : 0;
  if (isFiniteNumber(source?.out)) return source.out;
  if (Number.isInteger(item?.duration) && isPositiveNumber(fps)) {
    return inSeconds + (item.duration / fps) * (isPositiveNumber(source?.speed) ? source.speed : 1);
  }
  return null;
}

export async function readRequiredText(filePath, label, override) {
  if (override?.present) {
    if (typeof override.text !== "string") {
      throw new ExecutionError(`${label} cannot be read: in-memory override is absent`);
    }
    return override.text;
  }
  try {
    await access(filePath, fsConstants.R_OK);
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new ExecutionError(`${label} cannot be read: ${messageOf(error)}`);
  }
}

export function resolveReference(editPath, reference, paths = null) {
  return resolveReferenceBinding(editPath, reference, paths).path;
}

export function resolveReferenceBinding(editPath, reference, paths = null) {
  const projectPath = isAbsolute(reference) ? resolve(reference) : resolve(paths?.projectRoot ?? dirname(editPath), reference);
  if (paths === null || isRegularFileSync(projectPath)) {
    return { path: projectPath, libraryReference: false, scope: "project" };
  }
  const fallback = resolveLibraryFallback({
    projectRoot: paths.projectRoot,
    declaredPath: reference,
    references: paths.assetReferences,
    libraryRoots: paths.libraryRoots,
  });
  if (fallback.path !== null) {
    return { path: fallback.path, libraryReference: true, scope: "library" };
  }
  return { path: projectPath, libraryReference: fallback.matched, scope: "project" };
}

export function unfetchedLibraryNote(binding) {
  return binding.libraryReference ? "（共有ライブラリ参照（未取得））" : "";
}

export function isRegularFileSync(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export async function isRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function structureFinding(findings, path, message) {
  addFinding(findings, { severity: "error", check: "edit.structure", message, path });
}

export function captionFinding(findings, check, message, path) {
  addFinding(findings, { severity: "error", check, message, path });
}

export function addFinding(findings, finding) {
  findings.push(finding);
}

export function addSkipped(skipped, check, reason) {
  skipped.push({ check, reason });
}

export function relativePath(root, filePath) {
  const value = relative(root, filePath);
  return value === "" ? basename(filePath) : value;
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function numbersEqual(left, right) {
  return isFiniteNumber(left) && isFiniteNumber(right) && Math.abs(left - right) <= EPSILON;
}

export function formatNumber(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : String(value);
}

export function formatDb(value) {
  if (value === null) return "n/a";
  if (value === -Infinity) return "-inf dB";
  return `${formatNumber(value)} dB`;
}

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
