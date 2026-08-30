import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const serverEntry = path.join(repositoryRoot, "packages", "preview-server", "src", "server.mjs");
const fixtureRoot = path.join(repositoryRoot, "packages", "render-cut", "test", "fixtures", "item-keyframes");
const systemChrome = process.env.CHROME_PATH
  || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function launchChromeOrSkip(t) {
  try {
    return await chromium.launch({
      headless: true,
      ...(systemChrome && fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
    });
  } catch (error) {
    t.skip(`headless Chrome is unavailable: ${error.message.split("\n")[0]}`);
    return null;
  }
}

test("Web output preview interpolates item keyframes on every tick", async (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "akari-preview-item-keyframes-"));
  fs.cpSync(fixtureRoot, project, { recursive: true });
  const editPath = path.join(project, "edit.json");
  const edit = JSON.parse(fs.readFileSync(editPath, "utf8"));
  edit.sources = [];
  edit.tracks = edit.tracks.filter((track) => track.id !== "base");
  fs.writeFileSync(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    t.skip("local preview server sockets are unavailable in this sandbox");
    return;
  }
  const child = spawn(process.execPath, [serverEntry, project, "--port", String(port), "--no-lint"], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`preview server timeout: ${stderr}`)), 15_000);
    child.once("exit", code => reject(new Error(`preview server exited ${code}: ${stderr}`)));
    child.stdout.on("data", chunk => {
      if (!chunk.toString().includes(`:${port}`)) return;
      clearTimeout(timeout);
      resolve();
    });
  });

  const browser = await launchChromeOrSkip(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: "load" });
  await page.waitForSelector('[data-overlay-id="plain"]', { state: "attached" });
  await page.waitForFunction(() => typeof window.akari?.keyframes?.interpolateKeyframes === "function");

  const observe = async (seconds) => page.evaluate((value) => {
    window.akari.runtime.tick(value);
    const plain = document.querySelector('[data-overlay-id="plain"]');
    const bag = document.querySelector('[data-overlay-id="s01.B"]');
    const group = document.querySelector('[data-overlay-id="g1.first"]');
    return {
      plainX: Number.parseFloat(plain.style.getPropertyValue("--x")),
      bagX: Number.parseFloat(bag.style.getPropertyValue("--x")),
      groupOpacity: Number.parseFloat(group.style.opacity),
    };
  }, seconds);

  const first = await observe(1.1);
  const second = await observe(2.4);
  assert.ok(Math.abs(first.plainX - 110) <= 1, JSON.stringify(first));
  assert.ok(Math.abs(second.plainX - 240) <= 1, JSON.stringify(second));
  assert.notEqual(first.bagX, second.bagX);
  assert.ok(second.groupOpacity > first.groupOpacity, `${first.groupOpacity} -> ${second.groupOpacity}`);
});
