import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const headers = (key, json = false) => ({
  Authorization: `Key ${key}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

async function jsonResponse(response, label) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`${label} の応答が JSON ではありません`); }
  if (!response.ok) throw new Error(`${label} が HTTP ${response.status} を返しました`);
  return body;
}

export async function submit({ endpoint, body, key, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: headers(key, true),
    body: JSON.stringify(body),
  });
  const value = await jsonResponse(response, "fal submit");
  if (typeof value.request_id !== "string" || !value.request_id
    || typeof value.status_url !== "string" || !value.status_url
    || typeof value.response_url !== "string" || !value.response_url) {
    throw new Error("fal submit の応答に request_id/status_url/response_url がありません");
  }
  return value;
}

export async function fetchStatus({ statusUrl, key, fetchImpl = globalThis.fetch }) {
  const separator = statusUrl.includes("?") ? "&" : "?";
  const response = await fetchImpl(`${statusUrl}${separator}logs=1`, { headers: headers(key) });
  return jsonResponse(response, "fal status");
}

export async function pollStatus({
  statusUrl,
  key,
  fetchImpl = globalThis.fetch,
  intervalMs = 5_000,
  deadlineMs = 900_000,
  onTick = () => {},
}) {
  const started = Date.now();
  for (;;) {
    const value = await fetchStatus({ statusUrl, key, fetchImpl });
    onTick(value);
    if (value.status === "COMPLETED") return value;
    if (value.status === "FAILED" || value.error) {
      throw new Error(`fal 生成失敗: ${typeof value.error === "string" ? value.error : "FAILED"}`);
    }
    if (Date.now() - started >= deadlineMs) throw new Error("fal 生成がタイムアウトしました");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function fetchResponse({ responseUrl, key, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(responseUrl, { headers: headers(key) });
  return jsonResponse(response, "fal response");
}

export async function download({ url, dest, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`生成動画の取得に失敗しました（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  const temporary = `${dest}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, dest);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { bytes: bytes.length };
}
