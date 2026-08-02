#!/usr/bin/env node

// Tailscale の導入状態を、無償・読み取り専用の確認だけで判定する（setup-remote の doctor）。
// ネットワーク設定は一切変更しない。出力は JSON（stdout）のみ。
//
// state:
//   not-installed — tailscale CLI が見つからない
//   needs-login   — 導入済みだが未ログイン（BackendState: NeedsLogin / NoState）
//   stopped       — ログイン済み・接続オフ（BackendState: Stopped）
//   running       — 接続中（BackendState: Running / Starting）

import { execFile } from "node:child_process";
import net from "node:net";

const usage = "使い方: node skills/setup-remote/bin/doctor.mjs [--preview-port <port>]";
const execTimeoutMs = 5_000;
const portProbeTimeoutMs = 700;

let previewPort = 4567;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(usage);
    process.exit(0);
  } else if (args[i] === "--preview-port") {
    previewPort = Number(args[i + 1]);
    i += 1;
    if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535) {
      console.error(usage);
      process.exit(2);
    }
  } else {
    console.error(usage);
    process.exit(2);
  }
}

function run(bin, cliArgs) {
  return new Promise((resolve) => {
    execFile(bin, cliArgs, { timeout: execTimeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function cliCandidates() {
  if (process.platform === "darwin") {
    return ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  }
  if (process.platform === "win32") {
    return ["tailscale.exe", "tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"];
  }
  return ["tailscale"];
}

async function findCli() {
  for (const candidate of cliCandidates()) {
    const result = await run(candidate, ["version"]);
    if (result.ok && result.stdout.trim()) {
      return { path: candidate, version: result.stdout.trim().split("\n")[0] };
    }
  }
  return null;
}

// 未ログイン時は exit code が非 0 でも JSON が stdout に出る。パースできた方を信じる。
async function readStatus(cliPath) {
  const result = await run(cliPath, ["status", "--json"]);
  try {
    const parsed = JSON.parse(result.stdout);
    const dnsName = typeof parsed?.Self?.DNSName === "string"
      ? parsed.Self.DNSName.replace(/\.$/, "")
      : null;
    return {
      backendState: typeof parsed?.BackendState === "string" ? parsed.BackendState : null,
      dnsName,
      tailscaleIPs: Array.isArray(parsed?.Self?.TailscaleIPs) ? parsed.Self.TailscaleIPs : [],
    };
  } catch {
    return { backendState: null, dnsName: null, tailscaleIPs: [] };
  }
}

async function readServe(cliPath) {
  const result = await run(cliPath, ["serve", "status"]);
  const raw = (result.stdout + result.stderr).trim();
  const configured = result.ok && raw.length > 0 && !/no serve config/i.test(raw);
  return { configured, raw };
}

function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: portProbeTimeoutMs });
    const done = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function deriveState(cli, backendState) {
  if (!cli) return "not-installed";
  if (backendState === "Running" || backendState === "Starting") return "running";
  if (backendState === "Stopped") return "stopped";
  return "needs-login";
}

async function main() {
  const cli = await findCli();
  const status = cli ? await readStatus(cli.path) : { backendState: null, dnsName: null, tailscaleIPs: [] };
  const serve = cli && status.backendState === "Running"
    ? await readServe(cli.path)
    : { configured: false, raw: "" };
  const previewListening = await probePort(previewPort);
  const state = deriveState(cli, status.backendState);

  const report = {
    schema: "akari.setup-remote.doctor/v0",
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    state,
    tailscale: {
      installed: Boolean(cli),
      cliPath: cli?.path ?? null,
      version: cli?.version ?? null,
      backendState: status.backendState,
      dnsName: status.dnsName,
      tailscaleIPs: status.tailscaleIPs,
    },
    serve,
    preview: { port: previewPort, listening: previewListening },
    serveUrl: status.dnsName && serve.configured ? `https://${status.dnsName}` : null,
  };

  console.log(JSON.stringify(report, null, 2));
}

await main();
