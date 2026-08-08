import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const WORKSPACE_SCHEMA = "creator-root/v1";

/**
 * cwd から akari status のスコープを判定する。判定順は
 * (1) `.akari/root.json`（作業場）→ (2) `edit.json` または `.akari`（プロジェクト）→
 * (3) どちらも無し（対象外）。
 *
 * root.json の存在チェックを最優先するのは、作業場ルートにも `createCreatorRoot()` が
 * `.akari/connections.json` を書き出すため — これをプロジェクトの scaffold 済みマーカーと
 * 誤認しないための除外規約（`project-state.mjs` の `isWorkspaceRoot` 除外と同じ規律）。
 * root.json の中身の検証は行わない（存在チェックのみ）。壊れた root.json の扱いは
 * `resolveWorkspaceStatus` の fail-safe に委ねる。
 */
export function detectStatusScope(input = process.cwd()) {
  const cwd = resolve(input);
  if (existsSync(join(cwd, ".akari", "root.json"))) return "workspace";
  if (existsSync(join(cwd, "edit.json")) || existsSync(join(cwd, ".akari"))) return "project";
  return "none";
}

/**
 * 作業場スコープの status を解決する。検知と通知のみ（登録・移動・生成は一切しない）。
 * root.json が読めない・JSON が壊れている・schema が未知の場合は例外を投げず `null` を返す
 * （fail-safe: 壊れた作業場は黙って対象外）。
 *
 * v0 は `channels/*​/videos/*​/edit.json` 走査によるプロジェクト列挙までに限定する。
 * 拡張点: cards 契約（growth v0）が来たら、ここでカード未登録プロジェクトの拾い上げを追加する。
 */
export function resolveWorkspaceStatus(input = process.cwd()) {
  const rootDir = resolve(input);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(rootDir, ".akari", "root.json"), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(manifest) || manifest.schema !== WORKSPACE_SCHEMA) return null;

  const projects = listProjects(rootDir);
  const inboxNewCount = countVisibleEntries(join(rootDir, "inbox"));
  const nextAction = resolveNextAction(projects, inboxNewCount);

  return {
    version: 0,
    scope: "workspace",
    channels: Array.isArray(manifest.channels) ? [...manifest.channels] : [],
    projects,
    inbox: { new_count: inboxNewCount },
    next_action: nextAction,
  };
}

export function serializeWorkspaceStatus(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function formatWorkspaceStatusSummary(status) {
  const projectWord = `${status.projects.length} project${status.projects.length === 1 ? "" : "s"}`;
  const inboxWord = status.inbox.new_count > 0 ? `, inbox ${status.inbox.new_count} new` : "";
  const next = status.next_action ? ` Next: ${status.next_action.action} (${status.next_action.reason}).` : "";
  return `AKARI workspace: ${projectWord}${inboxWord}.${next}`;
}

function listProjects(rootDir) {
  const channelsDir = join(rootDir, "channels");
  const projects = [];
  for (const channel of listDirectoryNames(channelsDir)) {
    const videosDir = join(channelsDir, channel, "videos");
    for (const name of listDirectoryNames(videosDir)) {
      if (existsSync(join(videosDir, name, "edit.json"))) {
        projects.push({ channel, name, path: `channels/${channel}/videos/${name}` });
      }
    }
  }
  return projects.sort((left, right) => (
    left.channel.localeCompare(right.channel, "en") || left.name.localeCompare(right.name, "en")
  ));
}

function listDirectoryNames(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function countVisibleEntries(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => !entry.name.startsWith(".")).length;
}

function resolveNextAction(projects, inboxNewCount) {
  if (inboxNewCount > 0) {
    return {
      kind: "human",
      action: "review-inbox",
      reason: `inbox has ${inboxNewCount} new item${inboxNewCount === 1 ? "" : "s"}`,
    };
  }
  if (projects.length === 0) {
    return { kind: "human", action: "create-project", reason: "workspace has no projects yet" };
  }
  return null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
