import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { enableWindowExpr } from "./enable-window.mjs";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;
// タイムアウト診断で持ち回る量。多すぎるとログが埋まるので直近だけ残す。
const PAGE_MESSAGE_LIMIT = 20;
const RECENT_FRAME_LIMIT = 5;

// シートに埋まった 3D シーン宣言の数。負荷起因のタイムアウトかを一目で判断する材料。
function countThreeDimensionalScenes(sheetPath) {
  try {
    return readFileSync(sheetPath, "utf8").split("data-akari-3d-scene").length - 1;
  } catch {
    return 0;
  }
}
const THREE_BUNDLE_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/vendor/three-bundle.js",
);
const THREE_RUNTIME_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/three-runtime.js",
);
// texts[]（troika-three-text 経由の 3D テキスト）を含むシートだけ追加で読み込む。
// 読み込み順は three-bundle.js → vendor-3d-text-bundle.js を厳守する
// （overlay-runtime/README.md「単一 three インスタンス制約への対応」— troika は
// vendored three を alias 解決するため、three-bundle.js が先に window.AkariThree.THREE を
// 作っていないと壊れる）
const THREE_TEXT_BUNDLE_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/vendor/vendor-3d-text-bundle.js",
);
const THREE_SCENE_SCRIPT_PATTERN = /(<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'))(?=[^>]*\bdata-akari-3d-scene\b)[^>]*>)([\s\S]*?)(<\/script\s*>)/giu;
const TEXTURE_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jfif", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  // 動画テクスチャ。原本ではなく編集用 720p プロキシを差すこと（skills/overlay-authoring/3d.md）
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);
// 動画テクスチャの上限。「原本を黙って通さない」（skills/overlay-authoring/3d.md）を実際に効かせる。
// 解像度ではなくバイト数で見るのは、シート生成が同期・純関数で ffprobe を呼ばないため
// （呼ぶと単体テストが使う極小のダミー動画も読めなくなる）。24MB は 720p / H.264 / CRF 23 なら
// 数分ぶんに相当し、実運用のプロキシは通るが 4K マスターは通らない目安。
// 埋め込みは base64（約 1.37 倍）になり、プレビューは毎 tick これをシークする
const MAX_VIDEO_TEXTURE_BYTES = 24 * 1024 * 1024;
// texts[].font の埋め込み用 MIME。troika は XMLHttpRequest(responseType:"arraybuffer") で読んで
// 自前パーサへ渡すだけなので実行上は無関係だが、data URI の型として正しい値を残す
const FONT_MIME_TYPES = new Map([
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
]);

export function renderOverlaySheet({ overlays, edit, projectRoot, duration }) {
  const orderedOverlays = orderOverlaysByTrack(overlays);
  const hasThreeDimensionalOverlay = orderedOverlays.some((overlay) =>
    overlay.html.includes("data-akari-3d-scene"),
  );
  // texts[] を含む宣言だけ vendor-3d-text-bundle.js（troika-three-text）を追加で読み込む。
  // 素朴な文字列検査で足りるのは、他フラグ（hasResolvedSingleLineCaption 等）と同じ判断
  const hasThreeDimensionalTextOverlay = hasThreeDimensionalOverlay
    && orderedOverlays.some((overlay) =>
      overlay.html.includes("data-akari-3d-scene") && overlay.html.includes('"texts"'),
    );
  const sheetOverlays = hasThreeDimensionalOverlay
    ? orderedOverlays.map((overlay) => ({
        ...overlay,
        html: embedThreeModels(overlay.html, projectRoot, overlay.id),
      }))
    : orderedOverlays;
  const hasResolvedSingleLineCaption = sheetOverlays.some((overlay) =>
    overlay.html.includes("akari-caption--single-line"),
  );
  const nodes = sheetOverlays
    .map((overlay, index) => renderOverlayNode(overlay, index))
    .join("\n");
  const threeTextBundleScript = hasThreeDimensionalTextOverlay
    ? `\n  <script>${inlineScript(readFileSync(THREE_TEXT_BUNDLE_PATH, "utf8"))}</script>`
    : "";
  const threeRuntimeScripts = hasThreeDimensionalOverlay
    ? `\n  <script>${inlineScript(readFileSync(THREE_BUNDLE_PATH, "utf8"))}</script>${threeTextBundleScript}\n  <script>${inlineScript(readFileSync(THREE_RUNTIME_PATH, "utf8"))}</script>`
    : "";
  // 3D は「動画テクスチャのシークが終わってから」描く。ここで描いてしまうと <video> がまだ
  // 前フレームの絵のままテクスチャへ上がり、同じ時刻でも直前に何を撮ったかで結果が変わる。
  // 収集だけ先にして、実際の描画は video の提示フレーム確定後（threeDrawStep）へ回す
  const threeSeekCollector = hasThreeDimensionalOverlay
    ? `\n      const pendingThreeDraws = [];`
    : "";
  const threeSeekBranch = hasThreeDimensionalOverlay
    ? `\n        const threeContainer = container.querySelector(':scope > .scene-content');\n        if (active && threeContainer?.querySelector('script[type="application/json"][data-akari-3d-scene]')) {\n          pendingThreeDraws.push([threeContainer, seconds - start]);\n        }`
    : "";
  const threeDrawStep = hasThreeDimensionalOverlay
    ? `\n      for (const [threeContainer, localSeconds] of pendingThreeDraws) {\n        window.akari.threeRuntime.render(threeContainer, localSeconds);\n      }`
    : "";
  // 3D の動画テクスチャはランタイムが loop を立てて作るので、素材の尺より合成が長いときは
  // 畳んで回す（畳まないと末尾のフレームで静止する）。2D だけのシートは従来どおり
  // 合成時刻をそのまま渡す — 非 3D シートのバイト同一性を崩さないため宣言ごと出し分ける
  const videoSeekTarget = hasThreeDimensionalOverlay ? "target" : "seconds";
  const videoSeekTargetDeclaration = hasThreeDimensionalOverlay
    ? `\n          const target = video.loop && Number.isFinite(video.duration) && video.duration > 0\n            ? seconds % video.duration\n            : seconds;`
    : "";
  const threeReadySetup = hasThreeDimensionalOverlay
    ? `\n    const threeContainers = Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content')).filter((container) =>\n      container.querySelector('script[type="application/json"][data-akari-3d-scene]')\n    );\n    for (const container of threeContainers) {\n      window.akari.threeRuntime.render(container, 0);\n    }\n    async function waitForThreeContainer(container) {\n      while (true) {\n        const status = window.akari.threeRuntime.inspect(container).status;\n        if (status === 'ready') return;\n        if (status === 'error') {\n          console.error('[akari-three] 3D scene の読み込みエラーを fallback 表示のまま続行します');\n          return;\n        }\n        if (status !== 'loading') {\n          console.error('[akari-three] 3D scene を初期化できないため fallback 表示のまま続行します', status);\n          return;\n        }\n        await new Promise((resolve) => setTimeout(resolve, 10));\n      }\n    }`
    : "";
  const threeReadyWait = hasThreeDimensionalOverlay
    ? `\n      await Promise.all(threeContainers.map(waitForThreeContainer));`
    : "";
  const captionFontReadyWait = hasResolvedSingleLineCaption
    ? `\n      await document.fonts.load('600 82px "AKARI Noto Sans JP"');\n      if (!document.fonts.check('600 82px "AKARI Noto Sans JP"')) {\n        throw new Error('AKARI caption font did not load');\n      }`
    : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${edit.output.width},height=${edit.output.height}">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent !important; }
    #stage { position: relative; width: ${edit.output.width}px; height: ${edit.output.height}px; overflow: hidden; background: transparent; }
    .akari-overlay-container { position: absolute; inset: 0; visibility: hidden; pointer-events: none; transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg)); transform-origin: center; }
    .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
  </style>${threeRuntimeScripts}
</head>
<body>
  <div id="stage" data-composition-id="akari-render-cut" data-start="0" data-duration="${formatNumber(duration)}" data-width="${edit.output.width}" data-height="${edit.output.height}" data-fps="${edit.output.fps}" data-no-timeline>
${nodes}
  </div>
  <script>
    // Overlay fragments author entrance animations as plain CSS keyframes, but plain CSS
    // animations cannot survive a HyperFrames render: its producer free-runs this sheet on
    // a virtual clock (so they finish during page setup), and its deterministic CSS adapter
    // re-seeks them to composition time with no clip offset right before every frame
    // capture, baking the fill end state (issue #3). Convert each authored CSS animation
    // into a paused WAAPI clone whose delay absorbs the container's start instead: a write
    // of currentTime = composition time then lands every clone on the correct local frame
    // no matter which writer runs last — __akariSeek (puppeteer-core), the transport hold
    // loop below (HyperFrames), or HyperFrames' own WAAPI adapter. Disabling animation-name
    // afterwards cancels the originals so nothing free-runs or double-drives the elements.
    (function() {
      for (const container of document.querySelectorAll('.akari-overlay-container')) {
        const startMilliseconds = Number(container.dataset.start) * 1000;
        const conversions = [];
        for (const animation of container.getAnimations({ subtree: true })) {
          if (typeof CSSAnimation === 'undefined' || !(animation instanceof CSSAnimation)) continue;
          const effect = animation.effect;
          if (!effect || typeof effect.getKeyframes !== 'function' || !effect.target) continue;
          try {
            conversions.push({
              target: effect.target,
              keyframes: effect.getKeyframes(),
              timing: effect.getTiming(),
            });
          } catch {}
        }
        for (const conversion of conversions) {
          conversion.target.style.animationName = 'none';
        }
        for (const conversion of conversions) {
          const timing = conversion.timing;
          try {
            const clone = conversion.target.animate(conversion.keyframes, {
              delay: (Number(timing.delay) || 0) + startMilliseconds,
              endDelay: timing.endDelay,
              duration: timing.duration,
              iterations: timing.iterations,
              iterationStart: timing.iterationStart,
              direction: timing.direction,
              easing: timing.easing,
              fill: 'both',
            });
            clone.pause();
            clone.currentTime = 0;
          } catch {}
        }
      }
    })();
    window.__akariSyncAnimations = function(seconds) {
      const milliseconds = seconds * 1000;
      for (const container of document.querySelectorAll('.akari-overlay-container')) {
        for (const animation of container.getAnimations({ subtree: true })) {
          try { animation.pause(); } catch {}
          try { animation.currentTime = milliseconds; } catch {}
        }
      }
    };
    // HyperFrames never calls __akariSeek, so follow its transport clock instead. Only the
    // HyperFrames runtime defines window.__player; the puppeteer-core and static-screenshot
    // rasterizers never do, so for them the loop stays an idle poll for the life of the
    // page. It must never give up waiting for the player: setup burns virtual-clock rAF
    // ticks at an unpredictable rate, so any finite tick budget can die before the player
    // appears (observed with a 600-tick cap).
    (function() {
      if (document.querySelectorAll('.akari-overlay-container').length === 0) return;
      const hold = () => {
        try {
          const player = window.__player;
          const seconds = player && typeof player.getTime === 'function'
            ? Number(player.getTime())
            : NaN;
          if (Number.isFinite(seconds)) window.__akariSyncAnimations(seconds);
        } catch {}
        window.requestAnimationFrame(hold);
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(hold);
    })();
    window.__akariSeek = async function(seconds) {${threeSeekCollector}
      for (const container of document.querySelectorAll('.akari-overlay-container')) {
        const start = Number(container.dataset.start);
        const duration = Number(container.dataset.duration);
        const active = seconds >= start && seconds < start + duration;
        container.style.visibility = active ? 'visible' : 'hidden';${threeSeekBranch}
      }
      window.__akariSyncAnimations(seconds);
      const videoSeekTimeoutMilliseconds = 5000;
      const waitForVideo = (video, index) => new Promise((resolve) => {
        let animationFrameOne = null;
        let animationFrameTwo = null;
        let videoFrameCallback = null;
        let seekedListener = null;
        let settled = false;
        const finish = (warning = null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (seekedListener) video.removeEventListener('seeked', seekedListener);
          if (videoFrameCallback !== null && typeof video.cancelVideoFrameCallback === 'function') {
            video.cancelVideoFrameCallback(videoFrameCallback);
          }
          if (animationFrameOne !== null && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(animationFrameOne);
          }
          if (animationFrameTwo !== null && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(animationFrameTwo);
          }
          resolve(warning);
        };
        const waitForPresentedFrameWithAnimationFrames = () => {
          animationFrameOne = window.requestAnimationFrame(() => {
            animationFrameTwo = window.requestAnimationFrame(() => {
              finish();
            });
          });
        };
        const waitForPresentedVideoFrame = () => {
          videoFrameCallback = video.requestVideoFrameCallback(() => {
            videoFrameCallback = null;
            finish();
          });
        };
        const timeout = setTimeout(
          () => finish(\`video \${index + 1} seek/presentation timeout after \${videoSeekTimeoutMilliseconds}ms at \${seconds}s; continuing with the current frame\`),
          videoSeekTimeoutMilliseconds,
        );
        try {
          video.pause();${videoSeekTargetDeclaration}
          const alreadyAtTarget = !video.seeking
            && video.readyState >= 2
            && Math.abs(video.currentTime - ${videoSeekTarget}) < 0.000001;
          if (alreadyAtTarget) {
            finish();
            return;
          }
          const usesVideoFrameCallback = typeof video.requestVideoFrameCallback === 'function';
          if (usesVideoFrameCallback) {
            video.currentTime = ${videoSeekTarget};
            waitForPresentedVideoFrame();
          } else {
            seekedListener = () => {
              seekedListener = null;
              waitForPresentedFrameWithAnimationFrames();
            };
            video.addEventListener('seeked', seekedListener, { once: true });
            video.currentTime = ${videoSeekTarget};
          }
        } catch {
          finish();
        }
      });
      const warnings = (await Promise.all(
        Array.from(document.querySelectorAll('video'), waitForVideo),
      )).filter(Boolean);${threeDrawStep}
      await Promise.resolve();
      return { warnings };
    };${threeReadySetup}
    window.__akariReady = (async function() {
      await document.fonts.ready;${captionFontReadyWait}
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));${threeReadyWait}
      await Promise.all(Array.from(document.querySelectorAll('video')).map((video) =>
        video.readyState >= 2
          ? Promise.resolve()
          : new Promise((resolve) => {
              video.addEventListener('loadeddata', resolve, { once: true });
              video.addEventListener('error', resolve, { once: true });
            })
      ));
      await window.__akariSeek(0);
      return true;
    })();
  </script>
</body>
</html>
`;
}

export async function captureWithPuppeteer({
  sheetPath,
  chromePath,
  framesDirectory,
  overlayMovPath,
  width,
  height,
  fps,
  duration,
  ffmpegCommand,
  timeoutMs = captureTimeoutMs(),
  puppeteerModule = null,
  onWarning = null,
  onMetrics = null,
}) {
  const imported = puppeteerModule ?? await import("puppeteer-core");
  const puppeteer = imported.default ?? imported;
  await mkdir(framesDirectory, { recursive: true });
  const frameCount = Math.ceil(duration * fps);
  const captureStarted = performance.now();
  let browserLaunched = captureStarted;
  let pageReady = captureStarted;
  let frameLoopFinished = captureStarted;
  let browserClosed = captureStarted;
  let seekWaitMilliseconds = 0;
  let screenshotMilliseconds = 0;
  let browser = null;
  let watchdogExpired = false;
  const pageMessages = [];
  const recentFrameMilliseconds = [];
  try {
    browser = await withTimeout(
      puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        timeout: timeoutMs,
        userDataDir: join(framesDirectory, "chrome-profile"),
        args: [
          "--no-sandbox",
          "--disable-gpu",
          "--enable-unsafe-swiftshader",
          "--use-angle=swiftshader",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      }),
      timeoutMs,
      "launching Chrome",
    );
    browserLaunched = performance.now();
    const page = await withTimeout(browser.newPage(), timeoutMs, "opening a Puppeteer page");
    // タイムアウトしたとき「固まった」のか「単に遅い」のかを事後に切り分けられるよう、
    // ページ側の声と直近フレームの所要時間を握っておく（2026-08-04 PV ドッグフーディングで、
    // 診断が無いまま同じ症状を 3 回別々の原因に誤診した — 相関で犯人を決めさせないための材料）。
    if (typeof page.on === "function") {
      page.on("pageerror", (error) => {
        pageMessages.push(`pageerror: ${String(error).slice(0, 200)}`);
        if (pageMessages.length > PAGE_MESSAGE_LIMIT) pageMessages.shift();
      });
      page.on("console", (message) => {
        const type = message.type();
        if (type !== "error" && type !== "warning") return;
        pageMessages.push(`console.${type}: ${message.text().slice(0, 200)}`);
        if (pageMessages.length > PAGE_MESSAGE_LIMIT) pageMessages.shift();
      });
    }
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await withTimeout(
      page.setViewport({ width, height, deviceScaleFactor: 1 }),
      timeoutMs,
      "setting the Puppeteer viewport",
    );
    await withTimeout(
      page.goto(pathToFileURL(sheetPath).href, {
        waitUntil: "networkidle0",
        timeout: timeoutMs,
      }),
      timeoutMs,
      "loading the overlay sheet",
    );
    await withTimeout(
      page.evaluate(() => window.__akariReady),
      timeoutMs,
      "waiting for the overlay sheet",
    );
    pageReady = performance.now();
    for (let frame = 0; frame < frameCount; frame += 1) {
      const seekStarted = performance.now();
      const seekResult = await withTimeout(
        page.evaluate((seconds) => window.__akariSeek(seconds), frame / fps),
        timeoutMs,
        `seeking frame ${frame + 1}`,
      );
      seekWaitMilliseconds += performance.now() - seekStarted;
      for (const warning of seekResult?.warnings ?? []) {
        onWarning?.(
          `frame ${frame + 1}/${frameCount} at ${formatNumber(frame / fps)}s: ${warning}`,
        );
      }
      const screenshotStarted = performance.now();
      await withTimeout(
        page.screenshot({
          path: join(framesDirectory, `frame-${String(frame + 1).padStart(8, "0")}.png`),
          omitBackground: true,
        }),
        timeoutMs,
        `capturing frame ${frame + 1}`,
      );
      screenshotMilliseconds += performance.now() - screenshotStarted;
      recentFrameMilliseconds.push(Math.round(performance.now() - seekStarted));
      if (recentFrameMilliseconds.length > RECENT_FRAME_LIMIT) recentFrameMilliseconds.shift();
    }
    frameLoopFinished = performance.now();
  } catch (error) {
    watchdogExpired = isTimeoutError(error);
    if (watchdogExpired) {
      // 「遅くて 60 秒に触れた」のか「ページごと固着した」のかは、直前フレームの所要時間が
      // 伸びていたかどうかで読める。3D シーン数も併記して、負荷起因かを一目で判断できるようにする。
      const trend = recentFrameMilliseconds.length > 0
        ? `recent frame times: ${recentFrameMilliseconds.join("ms, ")}ms`
        : "no frame completed before the timeout";
      const scenes = countThreeDimensionalScenes(sheetPath);
      const voices = pageMessages.length > 0
        ? `; page said: ${pageMessages.slice(-3).join(" | ")}`
        : "; the page reported no errors or warnings";
      onWarning?.(
        `rasterizer timed out (${trend}; 3D scenes: ${scenes}${voices}). `
        + "Rising frame times mean the composition is too heavy for this machine's software WebGL — "
        + "reduce simultaneous 3D scenes or the output resolution.",
      );
    }
    throw error;
  } finally {
    await terminateBrowser(browser, { force: watchdogExpired, timeoutMs });
    browserClosed = performance.now();
  }

  const encodeStarted = performance.now();
  runChecked(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-framerate",
    String(fps),
    "-i",
    join(framesDirectory, "frame-%08d.png"),
    "-c:v",
    "qtrle",
    "-pix_fmt",
    "argb",
    overlayMovPath,
  ]);
  const captureFinished = performance.now();
  onMetrics?.({
    browser_launch_ms: roundMilliseconds(browserLaunched - captureStarted),
    page_setup_ms: roundMilliseconds(pageReady - browserLaunched),
    frame_loop_ms: roundMilliseconds(frameLoopFinished - pageReady),
    seek_wait_ms: roundMilliseconds(seekWaitMilliseconds),
    screenshot_ms: roundMilliseconds(screenshotMilliseconds),
    browser_close_ms: roundMilliseconds(browserClosed - frameLoopFinished),
    encode_ms: roundMilliseconds(captureFinished - encodeStarted),
    total_ms: roundMilliseconds(captureFinished - captureStarted),
  });
  return overlayMovPath;
}

export async function captureStaticOverlays({
  overlays,
  edit,
  projectRoot,
  temporaryDirectory,
  chromePath,
  timeoutMs = captureTimeoutMs(),
}) {
  const captures = [];
  for (const [index, overlay] of orderOverlaysByTrack(overlays).entries()) {
    const stem = `static-${String(index + 1).padStart(4, "0")}`;
    const htmlPath = join(temporaryDirectory, `${stem}.html`);
    const pngPath = join(temporaryDirectory, `${stem}.png`);
    const sampleTime = Math.min(0.25, overlay.duration / 2);
    const shifted = {
      ...overlay,
      start: -sampleTime,
      duration: Math.max(overlay.duration, sampleTime + 0.001),
    };
    await writeFile(
      htmlPath,
      renderOverlaySheet({
        overlays: [shifted],
        edit,
        projectRoot,
        duration: shifted.duration,
      }),
      "utf8",
    );
    const result = spawnSync(
      chromePath,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
        `--user-data-dir=${join(temporaryDirectory, `${stem}-chrome-profile`)}`,
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=1000",
        "--default-background-color=00000000",
        `--window-size=${edit.output.width},${edit.output.height}`,
        `--screenshot=${pngPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" },
    );
    if (result.error?.code === "ETIMEDOUT") {
      throw new Error(`Chrome screenshot timeout after ${timeoutMs}ms`);
    }
    if (result.status !== 0) {
      throw new Error(
        `Chrome screenshot failed (${result.signal ?? `exit ${result.status}`}): ${result.error?.message ?? result.stderr ?? result.stdout ?? "no output"}`,
      );
    }
    captures.push({ path: pngPath, start: overlay.start, duration: overlay.duration });
  }
  return captures;
}

function captureTimeoutMs() {
  const configured = Number(process.env.RENDER_CUT_CAPTURE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_CAPTURE_TIMEOUT_MS;
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

function isTimeoutError(error) {
  return error?.code === "ETIMEDOUT" || /timeout/iu.test(error?.message ?? "");
}

async function terminateBrowser(browser, { force, timeoutMs }) {
  if (!browser) return;
  const process = browser.process?.();
  try {
    await withTimeout(browser.close(), Math.min(timeoutMs, 2_000), "closing Puppeteer browser");
  } catch {
    force = true;
  }
  if (
    (force || browser.connected) &&
    process &&
    process.exitCode === null &&
    process.signalCode === null
  ) {
    process.kill("SIGKILL");
  }
}

function orderOverlaysByTrack(overlays) {
  return overlays
    .map((overlay, index) => ({ overlay, index }))
    .sort((left, right) => {
      const leftIsCaption = left.overlay.generatedFrom !== undefined;
      const rightIsCaption = right.overlay.generatedFrom !== undefined;
      if (leftIsCaption !== rightIsCaption) return leftIsCaption ? 1 : -1;
      const leftTrack = Number.isInteger(left.overlay.track) && left.overlay.track >= 0
        ? left.overlay.track
        : 0;
      const rightTrack = Number.isInteger(right.overlay.track) && right.overlay.track >= 0
        ? right.overlay.track
        : 0;
      return leftTrack - rightTrack || left.index - right.index;
    })
    .map(({ overlay }) => overlay);
}

export async function compositeAnimatedOverlay({
  ffmpegCommand,
  cutPath,
  overlayPath,
  outputPath,
  hasAudio,
  videoEncodeArgs = null,
  onProgress,
}) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    cutPath,
    "-i",
    overlayPath,
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto:shortest=1[composited];[composited]scale=out_range=tv[outv]",
    "-map",
    "[outv]",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath,
  ];
  if (onProgress) {
    await runCheckedWithProgress(ffmpegCommand, args, { onProgress });
  } else {
    runChecked(ffmpegCommand, args);
  }
}

export async function compositeStaticOverlays({
  ffmpegCommand,
  cutPath,
  captures,
  outputPath,
  hasAudio,
  duration,
  videoEncodeArgs = null,
  onProgress,
}) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", cutPath];
  for (const capture of captures) {
    args.push("-loop", "1", "-i", capture.path);
  }
  const filters = [];
  let previous = "[0:v]";
  for (const [index, capture] of captures.entries()) {
    const next = `[overlay${index}]`;
    const end = capture.start + capture.duration;
    filters.push(
      `${previous}[${index + 1}:v]overlay=0:0:format=auto:enable='${enableWindowExpr(capture.start, end)}'${next}`,
    );
    previous = next;
  }
  filters.push(`${previous}scale=out_range=tv[outv]`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-t",
    formatNumber(duration),
    ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath,
  );
  if (onProgress) {
    await runCheckedWithProgress(ffmpegCommand, args, { onProgress });
  } else {
    runChecked(ffmpegCommand, args);
  }
}

export function probeHasAlpha(ffprobeCommand, path) {
  const result = spawnSync(
    ffprobeCommand,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt:stream_tags=alpha_mode", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return false;
  const parsed = JSON.parse(result.stdout);
  const stream = parsed.streams?.[0] ?? {};
  return String(stream.pix_fmt ?? "").includes("a") || stream.tags?.alpha_mode === "1";
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim()
      .slice(-8000);
    throw new Error(`${command} ${result.signal ?? `exited ${result.status}`}: ${detail}`);
  }
  return result;
}

/**
 * `runChecked` の非同期・進捗ストリーミング版（`--progress` 時のみ使う。task
 * 2026-07-25-export-options）。`args` の先頭に `-progress pipe:1` を足して spawn し、
 * stdout の `out_time=HH:MM:SS.ffffff` 行だけを拾って `onProgress(elapsedSeconds)` を呼ぶ
 * （`out_time_ms`/`out_time_us` は ffmpeg のバージョンによって単位表記の慣習が割れているため
 * 使わない — akari-video-tauri/src-tauri/src/export/ffmpeg.rs の spawn_with_progress と同じ判断）。
 * stdout/stderr の双方に 'data' リスナーを付けておくことでパイプ詰まりによる子プロセスの
 * ブロックを避ける（Node の flowing モードでは明示スレッドを立てる必要がない）。
 */
export function runCheckedWithProgress(command, args, { cwd, env, onProgress } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, ["-progress", "pipe:1", ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stderrText = "";
    child.stdout.on("data", (chunk) => {
      stdoutTail += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = stdoutTail.indexOf("\n")) !== -1) {
        const line = stdoutTail.slice(0, newlineIndex).trim();
        stdoutTail = stdoutTail.slice(newlineIndex + 1);
        if (line.startsWith("out_time=")) {
          const seconds = parseFfmpegOutTime(line.slice("out_time=".length));
          if (seconds !== null) onProgress?.(seconds);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrText = (stderrText + chunk.toString()).slice(-32 * 1024);
    });
    child.on("error", (error) => rejectPromise(error));
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = stderrText.trim().slice(-8000);
      rejectPromise(new Error(`${command} ${signal ?? `exited ${code}`}: ${detail}`));
    });
  });
}

// ffmpeg -progress の "out_time=HH:MM:SS.ffffff" を秒に変換する。形式外・非有限値は
// 進捗欠落として無視する（誤表示より欠落を選ぶ — legacy parse_ffmpeg_timestamp と同じ判断）。
export function parseFfmpegOutTime(value) {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

function renderOverlayNode(overlay, index) {
  const transform = overlay.transform ?? {};
  // 2026-08-07 オーナー裁定: role==="background" は
  // ずらせない・必ずフレームを埋める種別。--x/--y/--scale/--rotate を無条件で恒等値へ
  // ロックする（transform も vars 経由の抜け道も無視する。edit-lint が同じ 2 条件を
  // データ側で弾くが、host 側でも二重にロックして「事故で黒が出る」を構造的に潰す。
  // preview-server の app.js / shell の overlay-runtime.js の mount と同じロック）。
  const isBackground = overlay.role === "background";
  const variables = {
    "--x": isBackground ? "0px" : `${transform.x ?? 0}px`,
    "--y": isBackground ? "0px" : `${transform.y ?? 0}px`,
    "--scale": isBackground ? "1" : String(transform.scale ?? 1),
    "--rotate": isBackground ? "0deg" : `${transform.rotate ?? 0}deg`,
    ...(overlay.vars ?? {}),
  };
  if (isBackground) {
    variables["--x"] = "0px";
    variables["--y"] = "0px";
    variables["--scale"] = "1";
    variables["--rotate"] = "0deg";
  }
  const style = Object.entries(variables)
    .map(([name, value]) => `${name}:${String(value).replaceAll(";", "")}`)
    .join(";");
  return `    <div class="akari-overlay-container scene clip" data-overlay-id="${escapeAttribute(overlay.id)}" data-start="${formatNumber(overlay.start)}" data-duration="${formatNumber(overlay.duration)}" data-track-index="${index + 1}" style="${escapeAttribute(style)}"><div class="scene-content">${overlay.html}</div></div>`;
}

function embedThreeModels(html, projectRoot, overlayId) {
  if (!html.includes("data-akari-3d-scene")) return html;
  let declarationCount = 0;
  const embedded = html.replace(
    THREE_SCENE_SCRIPT_PATTERN,
    (_match, openingTag, jsonText, closingTag) => {
      declarationCount += 1;
      let descriptor;
      try {
        descriptor = JSON.parse(jsonText);
      } catch (error) {
        throw new Error(
          `3D overlay ${overlayId} has invalid data-akari-3d-scene JSON: ${error.message}`,
        );
      }
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
        throw new TypeError(`3D overlay ${overlayId} scene declaration must be a JSON object`);
      }
      // texts[] があれば model は任意（three-runtime.js readDescriptor と同じ緩和。
      // contract-2026-08-12-3d-text-rail.md §3.1）
      const hasTexts = Array.isArray(descriptor.texts) && descriptor.texts.length > 0;
      if (descriptor.model !== undefined
        && (typeof descriptor.model !== "string" || descriptor.model.length === 0)) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      if (descriptor.model === undefined && !hasTexts) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      if (typeof descriptor.model === "string"
        && (descriptor.model.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(descriptor.model))) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      const embeddedDescriptor = { ...descriptor };
      if (typeof descriptor.model === "string") {
        const modelPath = resolve(projectRoot, descriptor.model);
        const model = readFileSync(modelPath);
        embeddedDescriptor.model = `data:model/gltf-binary;base64,${model.toString("base64")}`;
      }
      if (hasTexts) {
        embeddedDescriptor.texts = descriptor.texts.map((textDescriptor) => {
          const font = textDescriptor.font;
          if (typeof font !== "string"
            || font.length === 0
            || font.startsWith("/")
            || /^[a-z][a-z\d+.-]*:/i.test(font)) {
            throw new TypeError(
              `3D overlay ${overlayId} texts.${textDescriptor.id}.font must be a relative path`,
            );
          }
          const extension = extname(font).toLowerCase();
          const mimeType = FONT_MIME_TYPES.get(extension);
          if (!mimeType) {
            throw new TypeError(
              `3D overlay ${overlayId} texts.${textDescriptor.id}.font has an unsupported type: ${extension || "none"}`,
            );
          }
          const fontFile = readFileSync(resolve(projectRoot, font));
          return {
            ...textDescriptor,
            font: `data:${mimeType};base64,${fontFile.toString("base64")}`,
          };
        });
      }
      if (descriptor.environment?.map !== undefined) {
        const map = descriptor.environment.map;
        if (typeof map !== "string"
          || map.length === 0
          || map.startsWith("/")
          || /^[a-z][a-z\d+.-]*:/i.test(map)) {
          throw new TypeError(`3D overlay ${overlayId} environment.map must be a relative path`);
        }
        const mimeType = textureMimeType(map);
        if (!mimeType.startsWith("image/")) {
          throw new TypeError(
            `3D overlay ${overlayId} environment.map must be an equirectangular image: ${map}`,
          );
        }
        const image = readFileSync(resolve(projectRoot, map));
        embeddedDescriptor.environment = {
          ...descriptor.environment,
          map: `data:${mimeType};base64,${image.toString("base64")}`,
        };
      }
      if (descriptor.materialOverrides !== undefined) {
        if (!descriptor.materialOverrides
          || typeof descriptor.materialOverrides !== "object"
          || Array.isArray(descriptor.materialOverrides)) {
          throw new TypeError(`3D overlay ${overlayId} materialOverrides must be an object`);
        }
        embeddedDescriptor.materialOverrides = Object.fromEntries(
          Object.entries(descriptor.materialOverrides).map(([materialName, override]) => {
            if (!materialName
              || !override
              || typeof override !== "object"
              || Array.isArray(override)
              || Object.keys(override).some((key) => key !== "texture")
              || typeof override.texture !== "string"
              || override.texture.length === 0
              || override.texture.startsWith("/")
              || /^[a-z][a-z\d+.-]*:/i.test(override.texture)) {
              throw new TypeError(
                `3D overlay ${overlayId} materialOverrides.${materialName}.texture must be a relative path`,
              );
            }
            const texture = readFileSync(resolve(projectRoot, override.texture));
            const mimeType = textureMimeType(override.texture);
            if (mimeType.startsWith("video/") && texture.length > MAX_VIDEO_TEXTURE_BYTES) {
              throw new Error(
                `3D overlay ${overlayId} materialOverrides.${materialName}.texture is too large `
                  + `(${Math.round(texture.length / 1024 / 1024)}MiB > ${MAX_VIDEO_TEXTURE_BYTES / 1024 / 1024}MiB): `
                  + `${override.texture}\n`
                  + "  Give the 720p editing proxy, not the master. The sheet embeds this as base64\n"
                  + "  (~1.37x), and live preview seeks it on every tick.\n"
                  + `  ffmpeg -i <master> -vf scale=-2:720 -c:v libx264 -crf 23 -preset medium `
                  + "-pix_fmt yuv420p -an <proxy>.mp4",
              );
            }
            return [materialName, {
              texture: `data:${mimeType};base64,${texture.toString("base64")}`,
            }];
          }),
        );
      }
      return `${openingTag}${escapeScriptJson(JSON.stringify(embeddedDescriptor))}${closingTag}`;
    },
  );
  if (declarationCount === 0) {
    throw new Error(
      `3D overlay ${overlayId} must declare <script type="application/json" data-akari-3d-scene>`,
    );
  }
  return embedded;
}

function textureMimeType(path) {
  const extension = extname(path).toLowerCase();
  const mimeType = TEXTURE_MIME_TYPES.get(extension);
  if (!mimeType) throw new TypeError(`Unsupported material override texture type: ${extension || "none"}`);
  return mimeType;
}

function inlineScript(source) {
  return source.replaceAll("</script", "<\\/script");
}

function escapeScriptJson(json) {
  return json.replaceAll("<", "\\u003c");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatNumber(value) {
  return Number(value).toString();
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}
