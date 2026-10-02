import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// owner.json lets the next run reclaim a crashed process immediately. Directories created before
// owner tracking retain the 24h fallback, while a live owner is never touched.
const STALE_RUN_DIRECTORY_MS = 24 * 60 * 60 * 1000;

export function parseRunDirectoryOwner(text) {
  try {
    const owner = JSON.parse(text);
    return owner !== null && typeof owner === "object" && !Array.isArray(owner) ? owner : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export async function cleanupFailedRunTemporaryDirectory(
  temporaryDirectory,
  env = process.env,
  removeDirectory = rm,
) {
  if (!temporaryDirectory || env?.AKARI_KEEP_FAILED_RENDER_TMP === "1") return false;
  try {
    await removeDirectory(temporaryDirectory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// Allocates this run's own render-tmp subdirectory (fs.mkdtemp-equivalent uniqueness: an
// ISO8601-ish timestamp + pid prefix, plus mkdtemp's own random suffix, so even two processes
// starting in the same millisecond never collide). Runs a best-effort sweep for stale directories
// first so crashed runs don't leak disk space forever, without ever touching a directory an active
// concurrent run still owns (see cleanupStaleRunDirectories).
export async function createRunTemporaryDirectory(renderTmpRoot, {
  pid = process.pid,
  now = Date.now,
  isPidAlive = isProcessAlive,
} = {}) {
  await mkdir(renderTmpRoot, { recursive: true });
  const started = new Date(now());
  await cleanupStaleRunDirectories(renderTmpRoot, {
    now: () => started.getTime(),
    isPidAlive,
  });
  const isoStamp = started.toISOString().replace(/[:.]/gu, "-");
  const temporaryDirectory = await mkdtemp(join(renderTmpRoot, `${isoStamp}-${pid}-`));
  try {
    await writeFile(
      join(temporaryDirectory, "owner.json"),
      `${JSON.stringify({ pid, started: started.toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await cleanupFailedRunTemporaryDirectory(temporaryDirectory, {});
    throw error;
  }
  return temporaryDirectory;
}

async function readRunDirectoryOwner(entryPath) {
  try {
    return parseRunDirectoryOwner(await readFile(join(entryPath, "owner.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function cleanupStaleRunDirectories(renderTmpRoot, {
  now = Date.now,
  isPidAlive = isProcessAlive,
} = {}) {
  let entries;
  try {
    entries = await readdir(renderTmpRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const nowMs = now();
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const entryPath = join(renderTmpRoot, entry.name);
        try {
          const owner = await readRunDirectoryOwner(entryPath);
          if (owner !== null) {
            if (Number.isInteger(owner.pid) && owner.pid > 0 && !isPidAlive(owner.pid)) {
              await rm(entryPath, { recursive: true, force: true });
            }
            return;
          }
          const info = await stat(entryPath);
          if (nowMs - info.mtimeMs > STALE_RUN_DIRECTORY_MS) {
            await rm(entryPath, { recursive: true, force: true });
          }
        } catch {
          // Best-effort: another process may be concurrently using or removing this directory.
        }
      }),
  );
}
