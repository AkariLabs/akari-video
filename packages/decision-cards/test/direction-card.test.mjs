import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common installation path.
    }
  }
  return null;
}

function waitForOutput(child, stream, pattern, label) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}: ${output}${errorOutput}`));
    }, 10_000);

    function cleanup() {
      clearTimeout(timer);
      stream.off("data", onData);
      child.stderr?.off("data", onErrorData);
      child.off("exit", onExit);
    }

    function onData(chunk) {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (match) {
        cleanup();
        resolve(match);
      }
    }

    function onErrorData(chunk) {
      errorOutput += chunk.toString();
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`${label} exited with ${code}: ${output}${errorOutput}`));
    }

    stream.on("data", onData);
    if (child.stderr && child.stderr !== stream) {
      child.stderr.on("data", onErrorData);
    }
    child.on("exit", onExit);
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  command(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression) {
    const response = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description;
      throw new Error(description || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

async function startFixture(t) {
  if (typeof WebSocket === "undefined") {
    t.skip("Node.js with WebSocket support is required for the L1 test");
    return null;
  }
  const chromePath = await findChrome();
  if (!chromePath) {
    t.skip("Chrome/Chromium is required for the decision-cards browser test");
    return null;
  }

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "akari-decision-cards-"),
  );
  let helper = null;
  let chrome = null;
  let cdp = null;
  t.after(async () => {
    cdp?.close();
    if (chrome) await stopProcess(chrome);
    if (helper) await stopProcess(helper);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });
  const reportPath = path.join(temporaryDirectory, "report.html");
  const statePath = `${reportPath}.decisions.json`;
  await copyFile(path.join(packageDirectory, "examples/report.html"), reportPath);
  await copyFile(
    path.join(packageDirectory, "examples/report.html.decisions.json"),
    statePath,
  );

  helper = spawn(
    process.execPath,
    [path.join(packageDirectory, "report-helper.mjs"), reportPath, "--port", "0"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let reportUrl;
  try {
    const helperMatch = await waitForOutput(
      helper,
      helper.stdout,
      /HELPER: (http:\/\/localhost:\d+\/)/,
      "report helper",
    );
    reportUrl = helperMatch[1];
  } catch (error) {
    if (/listen EPERM/.test(error.message)) {
      t.skip("The sandbox forbids the localhost helper required by the L1 test");
      return null;
    }
    throw error;
  }

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(temporaryDirectory, "chrome-profile")}`,
      reportUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const chromeMatch = await waitForOutput(
    chrome,
    chrome.stderr,
    /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
    "headless Chrome",
  );
  const debugPort = chromeMatch[1];
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(
      (candidate) =>
        candidate.type === "page" && candidate.url.startsWith(reportUrl),
    );
  }, "Chrome did not open the sample report");

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.command("Runtime.enable");
  await waitFor(
    () =>
      cdp.evaluate(
        '!document.querySelector(\'[data-card="direction"] [data-option]\')?.disabled',
      ),
    "Direction card did not become interactive",
  );

  async function waitForState(predicate, message) {
    return waitFor(async () => {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      return predicate(state) ? state : null;
    }, message);
  }

  return { cdp, waitForState };
}

function decision(state, id) {
  return state.decisions.find((candidate) => candidate.id === id);
}

test("direction sample declares the complete defaults", async () => {
  const [report, template, stateSource] = await Promise.all([
    readFile(path.join(packageDirectory, "examples/report.html"), "utf8"),
    readFile(path.join(packageDirectory, "report-template.html"), "utf8"),
    readFile(
      path.join(packageDirectory, "examples/report.html.decisions.json"),
      "utf8",
    ),
  ]);
  const state = JSON.parse(stateSource);
  const direction = decision(state, "direction");
  assert.deepEqual(direction.answer, {
    preset: "youtube-long-standard",
    intensity: 50,
    allowed_means: [
      "実写 B ロール",
      "スクリーン録画・資料",
      "ストック素材",
      "AI 生成",
      "3D",
      "HTML 図解",
      "文字演出",
    ],
  });
  assert.equal(direction.byDefault, true);
  for (const source of [report, template]) {
    assert.match(source, /data-card="direction"/);
    assert.match(source, /data-range="intensity"/);
    assert.match(source, /data-array-check="allowed_means"/);
  }
  const directionMarkup = report.match(
    /<article\s+class="decision-card"\s+data-card="direction"[\s\S]*?<\/article>/,
  )?.[0];
  assert.ok(directionMarkup);
  assert.doesNotMatch(directionMarkup, /beats/);
});

test("direction inputs persist and existing four cards keep working", async (t) => {
  const fixture = await startFixture(t);
  if (!fixture) return;
  const { cdp, waitForState } = fixture;

  await cdp.evaluate(
    'document.querySelector(\'[data-card="direction"] [data-option="shorts-high-energy"]\').click()',
  );
  await waitForState(
    (state) => decision(state, "direction").answer.preset === "shorts-high-energy",
    "Preset change was not persisted",
  );
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[data-card="direction"] [data-range="intensity"]');
    input.value = '50.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForState(
    (state) => decision(state, "direction").answer.intensity === 51,
    "Integer intensity was not persisted",
  );
  assert.equal(
    await cdp.evaluate(
      'document.querySelector(\'[data-card="direction"] [data-range-value="intensity"]\').textContent',
    ),
    "51",
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-card="direction"] [data-array-value="AI 生成"]\').click()',
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-card="thumbnail"] [data-option="candidate-a"]\').click()',
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-card="cut-policy"] [data-option="aggressive"]\').click()',
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-card="captions-policy"] [data-check="karaoke"]\').click()',
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-card="structure"] [data-option="result-first"]\').click()',
  );
  const state = await waitForState(
    (candidate) =>
      !decision(candidate, "direction").answer.allowed_means.includes("AI 生成") &&
      decision(candidate, "thumbnail").answer.choice === "candidate-a" &&
      decision(candidate, "cut-policy").answer.intensity === "aggressive" &&
      decision(candidate, "captions-policy").answer.karaoke === true &&
      decision(candidate, "structure").answer.openingHook === "result-first",
    "Card changes were not persisted",
  );
  const direction = decision(state, "direction");
  assert.equal(Number.isInteger(direction.answer.intensity), true);
  assert.equal(direction.byDefault, false);
  assert.equal(direction.answer.allowed_means.length, 6);
  t.diagnostic(
    `observed direction=${JSON.stringify(direction.answer)}; existing-cards=4/4`,
  );
});

test("committing untouched defaults keeps direction byDefault true", async (t) => {
  const fixture = await startFixture(t);
  if (!fixture) return;
  const { cdp, waitForState } = fixture;
  await cdp.evaluate(
    'document.querySelector(\'[data-action="accept-all"]\').click()',
  );
  await cdp.evaluate(
    'document.querySelector(\'[data-action="commit"]\').click()',
  );
  const state = await waitForState(
    (candidate) => typeof candidate.completedAt === "string",
    "Default decision set was not committed",
  );
  const direction = decision(state, "direction");
  assert.equal(direction.answer.preset, "youtube-long-standard");
  assert.equal(direction.answer.intensity, 50);
  assert.equal(direction.answer.allowed_means.length, 7);
  assert.equal(direction.byDefault, true);
  assert.equal(direction.answeredAt, null);
  t.diagnostic(
    `observed default=${JSON.stringify(direction.answer)}; byDefault=${direction.byDefault}`,
  );
});
