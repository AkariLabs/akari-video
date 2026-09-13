import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import readline from "node:readline";

const exists = (path) => access(path).then(() => true, () => false);

class AppServer {
  #process;
  #lines;
  #nextId = 1;
  #pending = new Map();
  #turns = new Map();

  constructor({ command, cwd, env, spawnProcess, logError }) {
    this.command = command;
    this.cwd = cwd;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.logError = logError;
  }

  async start() {
    this.#process = this.spawnProcess(this.command, ["app-server", "-c", "features.imagegenext=true"], {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#process.once("error", (error) => this.#rejectAll(error));
    this.#process.once("exit", (code) => {
      if (code !== 0) this.#rejectAll(new Error(`Codex app-server が終了しました（exit ${code}）`));
    });
    this.#process.stdout.setEncoding("utf8");
    this.#process.stderr.setEncoding("utf8");
    this.#process.stderr.on("data", (chunk) => {
      if (/error|panic|not permitted/i.test(chunk)) this.logError(`[app-server] ${String(chunk).trim()}`);
    });
    this.#lines = readline.createInterface({ input: this.#process.stdout });
    this.#lines.on("line", (line) => this.#onLine(line));
    await this.request("initialize", {
      clientInfo: { title: "AKARI Video", name: "akari-video", version: "0.0.0" },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/textDelta",
        ],
      },
    });
    this.#send({ jsonrpc: "2.0", method: "initialized", params: {} });
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.#pending.has(message.id)) {
      const waiter = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "turn/completed" || message.method === "turn/failed") {
      const threadId = message.params?.threadId;
      const waiter = this.#turns.get(threadId);
      if (!waiter) return;
      this.#turns.delete(threadId);
      const status = message.params?.turn?.status ?? (message.method === "turn/failed" ? "failed" : "completed");
      if (status === "completed") waiter.resolve();
      else waiter.reject(new Error(message.params?.turn?.error?.message ?? `Codex turn が ${status} で終了しました`));
    }
  }

  #send(message) {
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #rejectAll(error) {
    for (const waiter of this.#pending.values()) waiter.reject(error);
    for (const waiter of this.#turns.values()) waiter.reject(error);
    this.#pending.clear();
    this.#turns.clear();
  }

  request(method, params) {
    const id = this.#nextId++;
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(id, { resolve: resolvePromise, reject });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async run(prompt) {
    const started = await this.request("thread/start", {
      cwd: this.cwd,
      model: null,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      serviceName: "akari_video",
      ephemeral: true,
      experimentalRawEvents: false,
    });
    const threadId = started.thread.id;
    const completed = new Promise((resolvePromise, reject) => this.#turns.set(threadId, { resolve: resolvePromise, reject }));
    await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      model: null,
      effort: null,
      outputSchema: null,
    });
    await completed;
  }

  close() {
    this.#lines?.close();
    this.#process?.kill();
  }
}

function promptFor(item, absoluteOutput) {
  return `${item.prompt}\n\n画像をちょうど 1 枚生成し、絶対パス ${absoluteOutput} に保存してください。` +
    "他のファイルを作成・変更せず、git を実行しないでください。返答は保存先だけにしてください。";
}

export async function generateCodexImages({
  projectDir,
  items,
  parallel = 4,
  env = process.env,
  spawnProcess = spawn,
  log = (line) => console.log(line),
  logError = (line) => console.error(line),
}) {
  const server = new AppServer({
    command: env.AKARI_CODEX_BIN ?? "codex",
    cwd: projectDir,
    env,
    spawnProcess,
    logError,
  });
  const queue = [...items];
  const results = [];
  if (queue.length === 0) return results;
  const sanitize = (value) => String(value)
    .replaceAll(resolve(projectDir), "<WORKTREE>")
    .replaceAll(homedir(), "<HOME>")
    .replaceAll(tmpdir(), "<TMP>");
  try {
    await server.start();
  } catch (error) {
    const reason = sanitize(error instanceof Error ? error.message : String(error));
    logError(`Codex app-server を起動できません: ${reason}`);
    server.close();
    return items.map((item) => ({ id: item.id, ok: false, error: reason }));
  }
  try {
    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift();
        const output = resolve(projectDir, item.path);
        const root = resolve(projectDir);
        if (output !== root && !output.startsWith(`${root}${sep}`)) {
          results.push({ id: item.id, ok: false, error: "出力先がプロジェクト外です" });
          continue;
        }
        if (await exists(output)) {
          log(`WARN: ${item.id} は既存ファイルを使います`);
          results.push({ id: item.id, ok: true, existing: true, elapsed_s: 0 });
          continue;
        }
        const started = Date.now();
        try {
          await mkdir(dirname(output), { recursive: true });
          await server.run(promptFor(item, output));
          if (!(await exists(output))) throw new Error("生成ターン完了後も画像がありません");
          const elapsed_s = (Date.now() - started) / 1000;
          log(`生成 ${item.id}: 所要秒 ${elapsed_s.toFixed(1)}`);
          results.push({ id: item.id, ok: true, elapsed_s });
        } catch (error) {
          const reason = sanitize(error instanceof Error ? error.message : String(error));
          logError(`生成失敗 ${item.id}: ${reason}`);
          results.push({ id: item.id, ok: false, error: reason });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, () => worker()));
  } finally {
    server.close();
  }
  return items.map((item) => results.find((result) => result.id === item.id));
}
