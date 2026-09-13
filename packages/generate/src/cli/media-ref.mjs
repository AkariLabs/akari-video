import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_INLINE_BYTES = 20 * 1024 * 1024;

const MIME = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".webp", "image/webp"], [".gif", "image/gif"], [".mp4", "video/mp4"],
  [".mov", "video/quicktime"], [".webm", "video/webm"], [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"], [".aac", "audio/aac"],
]);

function inside(projectDir, candidate) {
  const root = path.resolve(projectDir);
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`projectDir 外の参照は扱えません: ${candidate}`);
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

export function makeReference(projectDir, candidate, { source_id = null, name = null, role = null, range_s = null } = {}) {
  const resolved = inside(projectDir, candidate);
  const bytes = readFileSync(resolved.absolute);
  return {
    path: resolved.relative,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_id,
    name,
    role,
    range_s,
  };
}

export function resolveMedia(ref, { projectDir, maxBytes = MAX_INLINE_BYTES } = {}) {
  if (!projectDir) throw new Error("resolveMedia には projectDir が必要です");
  const { absolute } = inside(projectDir, ref?.path);
  const size = statSync(absolute).size;
  if (size > maxBytes) throw new Error("20 MB 超の参照は未対応（fal storage は後日）");
  const mime = MIME.get(path.extname(absolute).toLowerCase()) ?? "application/octet-stream";
  return `data:${mime};base64,${readFileSync(absolute).toString("base64")}`;
}

export function createMediaResolver(projectDir, options = {}) {
  return (ref) => resolveMedia(ref, { projectDir, ...options });
}
