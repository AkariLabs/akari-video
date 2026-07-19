import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const THREE_BUNDLE_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/vendor/three-bundle.js",
);
const THREE_RUNTIME_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/three-runtime.js",
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
]);

export function renderOverlaySheet({ overlays, edit, projectRoot, duration }) {
  const hasThreeDimensionalOverlay = overlays.some((overlay) =>
    overlay.html.includes("data-akari-3d-scene"),
  );
  const sheetOverlays = hasThreeDimensionalOverlay
    ? overlays.map((overlay) => ({
        ...overlay,
        html: embedThreeModels(overlay.html, projectRoot, overlay.id),
      }))
    : overlays;
  const nodes = sheetOverlays
    .map((overlay, index) => renderOverlayNode(overlay, index))
    .join("\n");
  const threeRuntimeScripts = hasThreeDimensionalOverlay
    ? `\n  <script>${inlineScript(readFileSync(THREE_BUNDLE_PATH, "utf8"))}</script>\n  <script>${inlineScript(readFileSync(THREE_RUNTIME_PATH, "utf8"))}</script>`
    : "";
  const threeSeekBranch = hasThreeDimensionalOverlay
    ? `\n        const threeContainer = container.querySelector(':scope > .scene-content');\n        if (active && threeContainer?.querySelector('script[type="application/json"][data-akari-3d-scene]')) {\n          window.akari.threeRuntime.render(threeContainer, seconds - start);\n        }`
    : "";
  const threeReadySetup = hasThreeDimensionalOverlay
    ? `\n    const threeContainers = Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content')).filter((container) =>\n      container.querySelector('script[type="application/json"][data-akari-3d-scene]')\n    );\n    for (const container of threeContainers) {\n      window.akari.threeRuntime.render(container, 0);\n    }\n    async function waitForThreeContainer(container) {\n      while (true) {\n        const status = window.akari.threeRuntime.inspect(container).status;\n        if (status === 'ready') return;\n        if (status === 'error') {\n          console.error('[akari-three] 3D scene の読み込みエラーを fallback 表示のまま続行します');\n          return;\n        }\n        if (status !== 'loading') {\n          console.error('[akari-three] 3D scene を初期化できないため fallback 表示のまま続行します', status);\n          return;\n        }\n        await new Promise((resolve) => setTimeout(resolve, 10));\n      }\n    }`
    : "";
  const threeReadyWait = hasThreeDimensionalOverlay
    ? `\n      await Promise.all(threeContainers.map(waitForThreeContainer));`
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
    window.__akariSeek = async function(seconds) {
      for (const container of document.querySelectorAll('.akari-overlay-container')) {
        const start = Number(container.dataset.start);
        const duration = Number(container.dataset.duration);
        const active = seconds >= start && seconds < start + duration;
        container.style.visibility = active ? 'visible' : 'hidden';
        const localMilliseconds = Math.max(0, Math.min(duration, seconds - start)) * 1000;
        for (const animation of container.getAnimations({ subtree: true })) {
          animation.pause();
          try { animation.currentTime = localMilliseconds; } catch {}
        }${threeSeekBranch}
      }
      for (const video of document.querySelectorAll('video')) {
        try { video.pause(); video.currentTime = seconds; } catch {}
      }
      await Promise.resolve();
    };${threeReadySetup}
    window.__akariReady = (async function() {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));${threeReadyWait}
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
}) {
  const imported = await import("puppeteer-core");
  const puppeteer = imported.default ?? imported;
  await mkdir(framesDirectory, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
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
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => window.__akariReady);
    const frameCount = Math.ceil(duration * fps);
    for (let frame = 0; frame < frameCount; frame += 1) {
      await page.evaluate((seconds) => window.__akariSeek(seconds), frame / fps);
      await page.screenshot({
        path: join(framesDirectory, `frame-${String(frame + 1).padStart(8, "0")}.png`),
        omitBackground: true,
      });
    }
  } finally {
    await browser.close();
  }

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
  return overlayMovPath;
}

export async function captureStaticOverlays({
  overlays,
  edit,
  projectRoot,
  temporaryDirectory,
  chromePath,
}) {
  const captures = [];
  for (const [index, overlay] of overlays.entries()) {
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
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `Chrome screenshot failed (${result.signal ?? `exit ${result.status}`}): ${result.error?.message ?? result.stderr ?? result.stdout ?? "no output"}`,
      );
    }
    captures.push({ path: pngPath, start: overlay.start, duration: overlay.duration });
  }
  return captures;
}

export function compositeAnimatedOverlay({
  ffmpegCommand,
  cutPath,
  overlayPath,
  outputPath,
  hasAudio,
}) {
  runChecked(ffmpegCommand, [
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
    "[0:v][1:v]overlay=0:0:format=auto:shortest=1[outv]",
    "-map",
    "[outv]",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath,
  ]);
}

export function compositeStaticOverlays({
  ffmpegCommand,
  cutPath,
  captures,
  outputPath,
  hasAudio,
  duration,
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
      `${previous}[${index + 1}:v]overlay=0:0:format=auto:enable='between(t,${formatNumber(capture.start)},${formatNumber(end)})'${next}`,
    );
    previous = next;
  }
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    previous,
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-t",
    formatNumber(duration),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath,
  );
  runChecked(ffmpegCommand, args);
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

function renderOverlayNode(overlay, index) {
  const transform = overlay.transform ?? {};
  const variables = {
    "--x": `${transform.x ?? 0}px`,
    "--y": `${transform.y ?? 0}px`,
    "--scale": String(transform.scale ?? 1),
    "--rotate": `${transform.rotate ?? 0}deg`,
    ...(overlay.vars ?? {}),
  };
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
      if (typeof descriptor.model !== "string" || descriptor.model.length === 0) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      if (descriptor.model.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(descriptor.model)) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      const modelPath = resolve(projectRoot, descriptor.model);
      const model = readFileSync(modelPath);
      const embeddedDescriptor = {
        ...descriptor,
        model: `data:model/gltf-binary;base64,${model.toString("base64")}`,
      };
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
