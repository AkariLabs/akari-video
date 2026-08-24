import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

const POLL_INTERVAL_MS = 25;
const CLOSE_TIMEOUT_MS = 2_000;
const PROFILE_PROCESS_EXIT_TIMEOUT_MS = 5_000;
const PROFILE_REMOVE_TIMEOUT_MS = 8_000;
const PROFILE_REMOVE_RETRY_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const USER_MESSAGE = "字幕レンダ用ブラウザの起動に失敗しました。Google Chrome のインストールと、CHROME_PATH が .app 内の実行ファイルを指していることを確認してください。";

export class BrowserLaunchError extends Error {
  constructor(detail, options = {}) {
    super(`${USER_MESSAGE} 詳細: ${detail}`, options);
    this.name = "BrowserLaunchError";
  }
}

/**
 * Chrome の起動・Puppeteer 接続・専用プロファイル削除を一つのライフサイクルに束ねる。
 * macOS の .app 内 Chrome は直接 spawn せず LaunchServices を経由する。
 */
export async function launchBrowser({
  puppeteer,
  chromePath,
  profileParent,
  profilePrefix = "chrome-profile-",
  args = [],
  timeoutMs,
  platform = process.platform,
  failureMarkerPath = null,
  launchMacApplication = launchThroughLaunchServices,
  closeRemoteBrowser = sendBrowserClose,
  onError = (message) => console.error(message),
}) {
  const previousFailure = failureMarkerPath
    ? await readFile(failureMarkerPath, "utf8").catch(() => null)
    : null;
  if (previousFailure) {
    const error = new BrowserLaunchError(
      `同じ書き出し内で先行するブラウザ起動が失敗したため、簡易描画へ切り替えず停止します (${previousFailure.trim()})`,
    );
    onError?.(error.message);
    throw error;
  }
  await mkdir(profileParent, { recursive: true });
  const userDataDir = await mkdtemp(join(profileParent, profilePrefix));
  const appPath = platform === "darwin" ? chromeAppBundlePath(chromePath) : null;
  const usesLaunchServices = appPath !== null;
  let browser = null;
  let browserWSEndpoint = null;
  try {
    if (usesLaunchServices) {
      await launchMacApplication({
        appPath,
        args: [
          "--headless=new",
          "--remote-debugging-port=0",
          `--user-data-dir=${userDataDir}`,
          ...args,
        ],
      });
      const activePort = await waitForDevToolsActivePort({ userDataDir, timeoutMs });
      browserWSEndpoint = activePort.browserWSEndpoint;
      browser = await connectWithRetry({
        puppeteer,
        browserWSEndpoint,
        timeoutMs,
      });
    } else {
      browser = await withTimeout(
        puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          timeout: timeoutMs,
          userDataDir,
          args,
        }),
        timeoutMs,
        "launching Chrome",
      );
      browserWSEndpoint = browser.wsEndpoint?.() ?? null;
    }

    let closed = false;
    return {
      browser,
      userDataDir,
      async close({ force = false } = {}) {
        if (closed) return;
        closed = true;
        let closeError = null;
        try {
          await closeBrowser({
            browser,
            browserWSEndpoint,
            force,
            usesLaunchServices,
            userDataDir,
            timeoutMs,
            closeRemoteBrowser,
          });
        } catch (error) {
          closeError = error;
        }
        try {
          await removeProfile(userDataDir);
        } catch (error) {
          if (closeError) {
            throw new AggregateError(
              [closeError, error],
              "Chrome の終了待機と一時プロファイルの削除に失敗しました",
            );
          }
          throw error;
        }
        if (closeError) throw closeError;
      },
    };
  } catch (error) {
    if (browser) {
      await closeBrowser({
        browser,
        browserWSEndpoint,
        force: true,
        usesLaunchServices,
        userDataDir,
        timeoutMs,
        closeRemoteBrowser,
      });
    } else if (usesLaunchServices) {
      browserWSEndpoint ??= await readDevToolsActivePort(userDataDir)
        .then((activePort) => activePort.browserWSEndpoint)
        .catch(() => null);
      if (browserWSEndpoint) await closeRemoteBrowser(browserWSEndpoint).catch(() => {});
    }
    await removeProfile(userDataDir);
    const wrapped = error instanceof BrowserLaunchError
      ? error
      : new BrowserLaunchError(error?.message ?? String(error), { cause: error });
    if (failureMarkerPath) {
      await writeFile(failureMarkerPath, `${wrapped.message}\n`, "utf8").catch(() => {});
    }
    onError?.(wrapped.message);
    throw wrapped;
  }
}

export function chromeAppBundlePath(chromePath) {
  if (typeof chromePath !== "string" || chromePath.length === 0) return null;
  const parts = chromePath.split(sep);
  const appIndex = parts.findIndex((part) => part.endsWith(".app"));
  if (appIndex === -1) return null;
  const prefix = chromePath.startsWith(sep) ? sep : "";
  return prefix + parts.slice(0, appIndex + 1).filter(Boolean).join(sep);
}

export async function waitForDevToolsActivePort({
  userDataDir,
  timeoutMs,
  pollIntervalMs = POLL_INTERVAL_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    try {
      return await readDevToolsActivePort(userDataDir);
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  const error = new Error(
    `DevToolsActivePort timeout after ${timeoutMs}ms${lastError?.message ? ` (${lastError.message})` : ""}`,
  );
  error.code = "ETIMEDOUT";
  throw error;
}

export async function readDevToolsActivePort(userDataDir) {
  const text = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8");
  const [portText, endpointPath] = text.trim().split(/\r?\n/u);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DevToolsActivePort has an invalid port: ${portText ?? ""}`);
  }
  if (!endpointPath?.startsWith("/devtools/browser/")) {
    throw new Error("DevToolsActivePort has no browser endpoint");
  }
  return {
    port,
    browserWSEndpoint: `ws://127.0.0.1:${port}${endpointPath}`,
  };
}

async function launchThroughLaunchServices({ appPath, args }) {
  await spawnAndWait("/usr/bin/open", ["-na", appPath, "--args", ...args]);
}

async function spawnAndWait(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_000);
    });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(
        `LaunchServices ${signal ?? `exited ${code}`}: ${stderr.trim() || "no output"}`,
      ));
    });
  });
}

async function connectWithRetry({ puppeteer, browserWSEndpoint, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    try {
      return await puppeteer.connect({ browserWSEndpoint, defaultViewport: null });
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  const error = new Error(
    `puppeteer.connect timeout after ${timeoutMs}ms${lastError?.message ? ` (${lastError.message})` : ""}`,
  );
  error.code = "ETIMEDOUT";
  throw error;
}

async function closeBrowser({
  browser,
  browserWSEndpoint,
  force,
  usesLaunchServices,
  userDataDir,
  timeoutMs,
  closeRemoteBrowser,
}) {
  const process = browser.process?.();
  let closeFailed = false;
  try {
    await withTimeout(
      browser.close(),
      Math.min(timeoutMs, CLOSE_TIMEOUT_MS),
      "closing Puppeteer browser",
    );
  } catch {
    closeFailed = true;
  }

  if (usesLaunchServices && browserWSEndpoint) {
    if (closeFailed) await browser.disconnect?.().catch(() => {});
    // puppeteer.connect() 由来の Browser.close() は closeCallback が no-op のため、
    // ローカル CDP 接続を破棄するだけでリモート Chrome へ Browser.close を送らない。
    // browser.close() の成否に関係なく、外部起動した実プロセスを明示的に閉じる。
    await closeRemoteBrowser(browserWSEndpoint).catch(() => {});
  }
  if (usesLaunchServices) {
    await waitForProfileProcessesExit({ userDataDir });
  }
  if (
    !usesLaunchServices
    && (force || closeFailed || browser.connected)
    && process
    && process.exitCode === null
    && process.signalCode === null
  ) {
    process.kill("SIGKILL");
  }
}

async function sendBrowserClose(browserWSEndpoint) {
  if (typeof WebSocket !== "function") return;
  await new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(browserWSEndpoint);
    const timer = setTimeout(() => {
      socket.close();
      rejectPromise(new Error("Browser.close timeout"));
    }, CLOSE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    }, { once: true });
    socket.addEventListener("message", finish, { once: true });
    socket.addEventListener("close", finish, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      rejectPromise(new Error("Browser.close connection failed"));
    }, { once: true });
  });
}

export async function waitForProfileProcessesExit({
  userDataDir,
  timeoutMs = PROFILE_PROCESS_EXIT_TIMEOUT_MS,
  pollIntervalMs = 50,
  listProcesses = listProcessCommands,
}) {
  const deadline = Date.now() + timeoutMs;
  let emptyPolls = 0;
  do {
    const commands = await listProcesses();
    if (commands === null) {
      // ps が sandbox 等で利用できない環境でも、Browser.close 直後の終了猶予は確保する。
      await delay(Math.min(250, timeoutMs));
      return;
    }
    if (!commands.some((command) => command.includes(userDataDir))) {
      emptyPolls += 1;
      if (emptyPolls >= 2) return;
    } else {
      emptyPolls = 0;
    }
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  const error = new Error(
    `Chrome processes still reference the temporary profile after ${timeoutMs}ms`,
  );
  error.code = "ETIMEDOUT";
  throw error;
}

async function listProcessCommands() {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("/bin/ps", ["-axo", "command="], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolvePromise(null);
      return;
    }
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolvePromise(null));
    child.on("close", (code) => {
      resolvePromise(code === 0 ? stdout.split(/\r?\n/u).filter(Boolean) : null);
    });
  });
}

async function removeProfile(userDataDir) {
  const deadline = Date.now() + PROFILE_REMOVE_TIMEOUT_MS;
  let lastError = null;
  let attempt = 0;
  do {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!PROFILE_REMOVE_RETRY_CODES.has(error?.code)) throw error;
      lastError = error;
      attempt += 1;
      await delay(Math.min(250, 50 * attempt, Math.max(1, deadline - Date.now())));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

function withTimeout(promise, timeoutMs, operation) {
  let timer;
  const timeout = new Promise((_, rejectPromise) => {
    timer = setTimeout(() => {
      const error = new Error(`${operation} timeout after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      rejectPromise(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
