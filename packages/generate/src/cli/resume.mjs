import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { openProject } from "../../../edit-store/lib/project.js";
import { snapshot } from "../../../edit-store/lib/history-store.js";
import { readGenerationMeta } from "../../../edit-store/lib/generation-meta-node.js";

import { resolveFalKey } from "./credentials.mjs";
import { fetchStatus } from "./fal-queue.mjs";
import { readVideoMeta, writeFailed } from "./meta-video.mjs";
import { finalizeGeneratedVideo, probeVideo } from "./video.mjs";
import { findItem } from "./edit-replace.mjs";

export const usage = "使い方: akari generate resume <projectDir> [--item <itemId>] [--json]";

function parse(argv) {
  const options = { projectDir: null, itemId: null, json: false, help: false };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) { options.projectDir = path.resolve(argv[0]); index = 1; }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--item") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw Object.assign(new Error("--item の値がありません"), { exitCode: 2 });
      options.itemId = argv[++index];
    } else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw Object.assign(new Error(`不明な引数です: ${argument}`), { exitCode: 2 });
  }
  if (!options.help && !options.projectDir) throw Object.assign(new Error(`projectDir が必要です\n${usage}`), { exitCode: 2 });
  return options;
}

function sidecars(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sidecars(absolute));
    else if (entry.isFile() && entry.name.endsWith(".meta.json")) found.push(absolute);
  }
  return found.sort();
}

function stemFor(metaPath) {
  return path.basename(metaPath).replace(/\.mp4\.meta\.json$/u, "");
}

function matchesItem(stem, itemId) {
  return stem === itemId || new RegExp(`^${itemId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}-\\d+$`, "u").test(stem);
}

function elapsed(meta, now) {
  return Math.max(0, (now.getTime() - Date.parse(meta.job.started_at)) / 1000);
}

export async function runResumeCommand(argv, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.errorLog ?? console.error;
  try {
    const options = parse(argv);
    if (options.help) { log(usage); return { exitCode: 0 }; }
    const scanNow = (dependencies.now ?? (() => new Date()))();
    const candidates = sidecars(path.join(options.projectDir, "assets", "generated"))
      .map((metaPath) => {
        const sourcePath = metaPath.slice(0, -".meta.json".length);
        const read = readGenerationMeta({ projectRoot: options.projectDir, sourcePath, now: scanNow });
        return { metaPath, meta: read.meta ?? readVideoMeta(metaPath), state: read.state, stem: stemFor(metaPath) };
      })
      .filter(({ meta, stem }) => meta.kind === "video" && meta.status === "generating"
        && (!options.itemId || matchesItem(stem, options.itemId)));
    if (candidates.length === 0) { log(options.json ? "[]" : "再取得できる generating 動画はありません"); return { exitCode: 0, result: [] }; }
    const credentials = (dependencies.resolveFalKeyImpl ?? resolveFalKey)({ env: dependencies.env ?? process.env, credentialsFile: dependencies.credentialsFile });
    const identityProject = await (dependencies.openProjectImpl ?? openProject)(options.projectDir);
    const results = [];
    let failed = false;
    for (const candidate of candidates) {
      const now = (dependencies.now ?? (() => new Date()))();
      const age = elapsed(candidate.meta, now);
      const staleRemaining = candidate.meta.job.stale_after_s - age;
      const isStale = candidate.state === "stale" || age > candidate.meta.job.stale_after_s;
      const withoutSerial = candidate.stem.replace(/-\d+$/u, "");
      const itemId = options.itemId
        ?? (findItem(identityProject.edit, candidate.stem) ? candidate.stem
          : findItem(identityProject.edit, withoutSerial) ? withoutSerial : candidate.stem);
      let status;
      try {
        if (typeof candidate.meta.job.status_url !== "string") throw new Error("job.status_url がありません");
        status = await fetchStatus({ statusUrl: candidate.meta.job.status_url, key: credentials.key, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
      } catch (error) {
        const message = isStale
          ? `応答なし（経過 ${Math.floor(age)} 秒）。再取得に失敗: ${error.message}`
          : `待機中（経過 ${Math.floor(age)} 秒）。再取得に失敗: ${error.message}`;
        results.push({ item: itemId, status: "generating", message });
        if (!options.json) log(`${itemId}: ${message}`);
        continue;
      }
      try {
        if (status.status === "COMPLETED") {
          if (typeof candidate.meta.job.response_url !== "string") throw new Error("job.response_url がありません");
          const mp4AbsolutePath = candidate.metaPath.slice(0, -".meta.json".length);
          const mp4RelativePath = path.relative(options.projectDir, mp4AbsolutePath).split(path.sep).join("/");
          const completed = await finalizeGeneratedVideo({
            projectDir: options.projectDir, itemId, metaPath: candidate.metaPath,
            mp4AbsolutePath, mp4RelativePath, responseUrl: candidate.meta.job.response_url,
            key: credentials.key, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
            now: dependencies.now, startedMs: Date.parse(candidate.meta.job.started_at),
            openProjectImpl: dependencies.openProjectImpl ?? openProject,
            snapshotImpl: dependencies.snapshotImpl ?? snapshot,
            probeImpl: dependencies.probeImpl ?? probeVideo,
          });
          results.push({ item: itemId, status: "done", mp4: mp4RelativePath, out: completed.plan.out, freeze: completed.plan.freeze });
          if (!options.json) {
            const freeze = completed.plan.freeze === null
              ? "なし"
              : `${completed.plan.freeze.at_sec} 秒から ${completed.plan.freeze.duration_sec} 秒`;
            log(`${itemId}: 生成動画に差し替えました: ${mp4RelativePath}（out ${completed.plan.out}・freeze ${freeze}）`);
          }
        } else if (status.status === "FAILED" || status.error) {
          const reason = typeof status.error === "string" ? status.error : "provider FAILED";
          writeFailed({ metaPath: candidate.metaPath, reason, now: dependencies.now });
          results.push({ item: itemId, status: "failed", reason });
          if (!options.json) log(`${itemId}: 失敗: ${reason}`);
          failed = true;
        } else {
          const message = isStale
            ? `応答なし（経過 ${Math.floor(age)} 秒）。再取得を試しました`
            : `待機中（経過 ${Math.floor(age)} 秒・stale まで ${Math.max(0, Math.ceil(staleRemaining))} 秒）`;
          results.push({ item: itemId, status: "generating", message });
          if (!options.json) log(`${itemId}: ${message}`);
        }
      } catch (error) {
        writeFailed({ metaPath: candidate.metaPath, reason: error.message, now: dependencies.now });
        results.push({ item: itemId, status: "failed", reason: error.message });
        if (!options.json) log(`${itemId}: 失敗: ${error.message}`);
        failed = true;
      }
    }
    if (options.json) log(JSON.stringify(results));
    return { exitCode: failed ? 1 : 0, result: results };
  } catch (error) {
    errorLog(error instanceof Error ? error.message : String(error));
    return { exitCode: error?.exitCode ?? 1 };
  }
}

export const run = runResumeCommand;
export default runResumeCommand;
