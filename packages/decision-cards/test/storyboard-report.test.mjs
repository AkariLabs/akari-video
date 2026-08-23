import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildStoryboardRedpenText, renderResearchPlanReportFile } from "../render-research-plan-report.mjs";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(packageDirectory, "test", "fixtures", "research-plan");
const artifactDirectory = path.join(packageDirectory, "test", "artifacts");
const screenshotDirectory = process.env.STORYBOARD_EVIDENCE_DIR
  ? path.resolve(process.env.STORYBOARD_EVIDENCE_DIR)
  : artifactDirectory;
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // 次の既知パスを試す。
    }
  }
  return null;
}

function withRenderedFixture(name, run) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-report-"));
  const outputPath = path.join(temporaryDirectory, `${name}.html`);
  try {
    renderResearchPlanReportFile(path.join(fixtureDirectory, name, "research-plan.json"), outputPath);
    return run({ outputPath, html: readFileSync(outputPath, "utf8") });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function waitFor(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const value = await check();
        if (value) {
          resolve(value);
          return;
        }
      } catch {
        // 読み込み完了まで再試行する。
      }
      if (Date.now() >= deadline) {
        reject(new Error(message));
        return;
      }
      setTimeout(attempt, 40);
    };
    attempt();
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

class CdpPipeClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.errorOutput = "";
    child.stdio[4].on("data", (chunk) => this.receive(chunk));
    child.stderr.on("data", (chunk) => {
      this.errorOutput += chunk.toString();
    });
    child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Chrome が終了しました (${code ?? signal}) ${this.errorOutput}`));
      }
      this.pending.clear();
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let delimiter = this.buffer.indexOf(0);
    while (delimiter !== -1) {
      const payload = this.buffer.subarray(0, delimiter).toString("utf8");
      this.buffer = this.buffer.subarray(delimiter + 1);
      if (payload) {
        const message = JSON.parse(payload);
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      }
      delimiter = this.buffer.indexOf(0);
    }
  }

  command(method, params = {}, sessionId = null) {
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} がタイムアウトしました ${this.errorOutput}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.child.stdio[3].write(`${JSON.stringify(message)}\0`);
    return result;
  }
}

async function startChromeFixture(t, outputPath) {
  const chromePath = findChrome();
  if (!chromePath) {
    t.skip("Chrome/Chromium が無いため実機 DOM 検証を省略");
    return null;
  }
  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-pipe",
    `--user-data-dir=${path.join(profileDirectory, "profile")}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  t.after(async () => {
    await stopProcess(chrome);
    rmSync(profileDirectory, { recursive: true, force: true });
  });
  const cdp = new CdpPipeClient(chrome);
  try {
    await cdp.command("Browser.getVersion");
  } catch {
    t.skip("実行環境が headless Chrome の起動を許可していないため実機検証を省略");
    return null;
  }
  const { targetId } = await cdp.command("Target.createTarget", { url: pathToFileURL(outputPath).href });
  const { sessionId } = await cdp.command("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params = {}) => cdp.command(method, params, sessionId);
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => evaluate("document.readyState === 'complete' && document.querySelectorAll('[data-shot-row]').length > 0"), "絵コンテレポートが読み込まれませんでした");
  return { command, evaluate };
}

async function screenshot(command, filename) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const captured = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const screenshotPath = path.join(screenshotDirectory, filename);
  writeFileSync(screenshotPath, Buffer.from(captured.data, "base64"));
  assert.ok(statSync(screenshotPath).size > 10_000, `${filename} が小さすぎます`);
  return screenshotPath;
}

test("画像あり fixture は自己完結 img をコマ面へ埋め込む", () => {
  withRenderedFixture("with-image", ({ html }) => {
    assert.match(html, /<img class="shot-image" data-shot-image src="data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(html, /src="shot\.svg"/);
    assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
  });
});

test("画像なし fixture は shot_type と description のプレースホルダーを表示する", () => {
  withRenderedFixture("without-image", ({ html }) => {
    assert.match(html, /data-shot-placeholder/);
    assert.match(html, />overhead</);
    assert.match(html, /机の上で工程を説明する俯瞰ショット/);
  });
});

test("3章 + カットアウェイ2本 fixture は主軸・分岐・戻り線を SVG DOM に持つ", () => {
  withRenderedFixture("branching", ({ html }) => {
    assert.equal(count(html, /data-shot-row(?:\s|>)/g), 5);
    assert.equal(count(html, /<template data-shot-detail-template=/g), 5);
    assert.equal(count(html, /class="shot-row shot-row--cutaway"/g), 2);
    assert.match(html, /<svg data-storyboard-flow/);
    assert.equal(count(html, /data-flow-role="main-node"/g), 3);
    assert.equal(count(html, /data-flow-role="cutaway-node"/g), 2);
    assert.equal(count(html, /data-flow-role="branch-line"/g), 2);
    assert.equal(count(html, /data-flow-role="return-line"/g), 2);
    assert.equal(count(html, /data-flow-role="chapter-band"/g), 3);
  });
});

test("新フィールド皆無の旧形式も生成でき、構造面は空面になる", () => {
  withRenderedFixture("legacy", ({ html }) => {
    assert.equal(count(html, /data-shot-row(?:\s|>)/g), 1);
    assert.equal(count(html, /<template data-shot-detail-template=/g), 1);
    assert.match(html, /data-shot-placeholder/);
    assert.match(html, /data-structure-empty/);
    assert.match(html, /構造情報なし/);
  });
});

test("詳細ダイアログと赤ペンの貼り戻し契約を自己完結 HTML に持つ", () => {
  withRenderedFixture("branching", ({ html }) => {
    assert.match(html, /<dialog class="shot-dialog" data-shot-dialog/);
    assert.match(html, /data-shot-detail="0"[\s\S]*?完成形から始める[\s\S]*?push-in[\s\S]*?中央へ/);
    assert.match(html, /data-shot-feedback="0"/);
    assert.match(html, /data-overall-feedback/);
    assert.match(html, /data-copy-redpen/);
    assert.match(html, /data-redpen-output/);
    assert.match(html, /composeRedpenText/);
    assert.match(html, /plan-comments\.json（pass: structure, target_kind: shot）として1ファイルに上書き保存/);
    assert.match(html, /処理後は plan-comments\.json を削除/);
    assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
  });
});

test("赤ペン貼り戻しテキストは shot id と指摘逐語を保持する", () => {
  const shotFeedback = "冒頭を 1 秒延ばす。\nただし説明文は変えない。";
  const overallFeedback = "全体の色味を揃える。";
  const output = buildStoryboardRedpenText({
    title: "3章の主軸とカットアウェイ",
    shots: [
      { id: "main-2", label: "工程を説明する", text: shotFeedback },
      { id: "cut-1", label: "手元へ挿入して戻る", text: "" },
    ],
    overall: overallFeedback,
  });
  assert.equal(output, `【絵コンテ赤ペン】3章の主軸とカットアウェイ
- shot main-2「工程を説明する」: ${shotFeedback}
- 全体: ${overallFeedback}
---
上の指摘を plan-comments.json（pass: structure, target_kind: shot）として1ファイルに上書き保存し、名指しされた shot だけ構成を改訂してください。
target_id は各 shot id に対応する structure.shots[] の配列インデックスを文字列で設定し、処理後は plan-comments.json を削除してください。`);
});

test("実機 Chrome でコマ詳細と赤ペン逐語を照合し、3 枚の証跡を生成する", async (t) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-report-"));
  const outputPath = path.join(temporaryDirectory, "branching.html");
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  renderResearchPlanReportFile(path.join(fixtureDirectory, "branching", "research-plan.json"), outputPath);
  const browser = await startChromeFixture(t, outputPath);
  if (!browser) return;
  const { command, evaluate } = browser;

  const initial = await evaluate(`(() => {
    document.querySelector('.storyboard-section').scrollIntoView({ block: 'start' });
    return {
      rows: document.querySelectorAll('[data-shot-row]').length,
      cutaways: document.querySelectorAll('.shot-row--cutaway').length,
      structureNodes: document.querySelectorAll('[data-flow-role="main-node"], [data-flow-role="cutaway-node"]').length
    };
  })()`);
  assert.deepEqual(initial, { rows: 5, cutaways: 2, structureNodes: 5 });
  const screenshots = [await screenshot(command, "01-koma-list.png")];

  const detail = await evaluate(`(() => {
    document.querySelector('[data-shot-id="main-1"] [data-shot-open]').click();
    const dialog = document.querySelector('[data-shot-dialog]');
    return {
      open: dialog.open,
      description: dialog.querySelector('.shot-detail__description')?.textContent,
      camera: dialog.querySelector('.shot-detail__facts')?.textContent,
      chapter: dialog.querySelector('.shot-detail__context')?.textContent,
      hasMedia: Boolean(dialog.querySelector('[data-shot-image], [data-shot-placeholder]'))
    };
  })()`);
  assert.equal(detail.open, true);
  assert.equal(detail.description, "完成形から始める");
  assert.match(detail.camera, /push-in/);
  assert.match(detail.camera, /中央へ/);
  assert.match(detail.chapter, /導入/);
  assert.equal(detail.hasMedia, true);
  screenshots.push(await screenshot(command, "02-koma-detail.png"));

  const feedback = "手元の動きをもう少し長く見せてください。";
  const overall = "結びまでテンポを保ってください。";
  const output = await evaluate(`(async () => {
    const shot = document.querySelector('[data-shot-feedback]');
    shot.value = ${JSON.stringify(feedback)};
    shot.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-shot-close]').click();
    const overall = document.querySelector('[data-overall-feedback]');
    overall.value = ${JSON.stringify(overall)};
    overall.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-copy-redpen]').click();
    document.querySelector('[data-redpen-section]').scrollIntoView({ block: 'start' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const output = document.querySelector('[data-redpen-output]');
    output.setSelectionRange(0, 0);
    output.blur();
    return output.value;
  })()`);
  assert.match(output, /^【絵コンテ赤ペン】3章の主軸とカットアウェイ/m);
  assert.match(output, new RegExp(`- shot main-1「完成形から始める」: ${feedback}`));
  assert.match(output, new RegExp(`- 全体: ${overall}`));
  assert.match(output, /plan-comments\.json（pass: structure, target_kind: shot）/);
  assert.match(output, /structure\.shots\[\] の配列インデックス/);
  screenshots.push(await screenshot(command, "03-redpen-output.png"));
  t.diagnostic(`screenshots: ${screenshots.join(", ")}`);
});
