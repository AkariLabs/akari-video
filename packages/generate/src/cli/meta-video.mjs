import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VALIDATOR = fileURLToPath(new URL("../../../schemas/bin/validate-generation-meta.mjs", import.meta.url));

function nowIso(now) {
  return (typeof now === "function" ? now() : now ?? new Date()).toISOString();
}

function writeValidated(metaPath, meta) {
  const temporary = `${metaPath}.tmp-${process.pid}-${Date.now()}.meta.json`;
  writeFileSync(temporary, `${JSON.stringify(meta, null, 2)}\n`);
  const checked = spawnSync(process.execPath, [VALIDATOR, temporary], { encoding: "utf8" });
  if (checked.status !== 0) {
    rmSync(temporary, { force: true });
    throw new Error(`generation meta の検証に失敗しました: ${(checked.stderr || checked.stdout).trim()}`);
  }
  renameSync(temporary, metaPath);
  return meta;
}

export function readVideoMeta(metaPath) {
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

export function writeGenerating({
  metaPath, model, inputs, output, cost, key_source, request_id, status_url,
  response_url, started_at, stale_after_s = 900, now,
}) {
  const at = started_at ?? nowIso(now);
  const meta = {
    version: 1,
    kind: "video",
    status: "generating",
    model: { id: model.id, endpoint: model.endpoint, as_of: model.as_of },
    inputs,
    output,
    cost: {
      estimate_usd: cost.estimate_usd ?? null,
      actual_usd: null,
      unit: model.price?.unit ?? "unknown",
      source: "estimate",
    },
    job: {
      provider: "fal", request_id, status_url, response_url,
      started_at: at, stale_after_s,
    },
    provenance: { created_at: at, tool: "akari generate video", key_source },
    history: [{ at, status: "generating", reason: null }],
  };
  return writeValidated(metaPath, meta);
}

export function writeDone({ metaPath, result, expanded_prompt, elapsed_s, now }) {
  const meta = readVideoMeta(metaPath);
  const at = nowIso(now);
  meta.status = "done";
  meta.cost.actual_usd = null;
  meta.cost.source = "estimate";
  meta.result = {
    ...result,
    ...(typeof expanded_prompt === "string" ? { expanded_prompt } : {}),
    elapsed_s,
  };
  meta.history.push({ at, status: "done", reason: null });
  return writeValidated(metaPath, meta);
}

export function writeFailed(metaPathOrOptions, reasonArg, nowArg) {
  const options = typeof metaPathOrOptions === "string"
    ? { metaPath: metaPathOrOptions, reason: reasonArg, now: nowArg }
    : metaPathOrOptions;
  const meta = readVideoMeta(options.metaPath);
  const at = nowIso(options.now);
  meta.status = "failed";
  delete meta.result;
  meta.history.push({ at, status: "failed", reason: String(options.reason) });
  return writeValidated(options.metaPath, meta);
}
