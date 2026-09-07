import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDeclaredProjectInput } from "./render-inputs.mjs";
import { stripHtmlComments } from "./html-scan.mjs";
import { runtimes, runtimeRoot, readDeclarations, declarationPattern, scriptApplies } from "../../overlay-runtime/runtimes.mjs";
import { embedFragmentAssets } from "./fragment-assets.mjs";
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;
// タイムアウト診断で持ち回る量。多すぎるとログが埋まるので直近だけ残す。
const PAGE_MESSAGE_LIMIT = 20;
const RECENT_FRAME_LIMIT = 5;

const SLOT_PARAMS_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/slot-params.js",
);
// モーション語彙（イージング名 + 対象別既定尺の CSS 変数）。プレビュー側はホストが
// <link> するのと同じ内容を、語彙を参照するシートにだけ埋め込む（パリティ）。
// 参照しないシートに埋め込まないのは、非対象シートのバイト同一性を守るため
// （runtimeScripts の出し分けと同じ判断）
const MOTION_VOCAB_CSS_PATH = resolve(
  SOURCE_DIRECTORY,
  "../../overlay-runtime/src/motion-vocab.css",
);
// One builder owns export spelling and whitespace for every manifest entry.
// Stable per-id names preserve existing sheet bytes and diagnostic consumers.
function buildRuntimeBlocks(entry, edit) {
  const id = entry.id;
  if (!/^[a-z][A-Za-z0-9_]*$/.test(id) || !/^[A-Za-z_$][\w$]*$/.test(entry.browserGlobal)) {
    throw new TypeError("runtime export identifiers must be JavaScript identifiers");
  }
  const title = id[0].toUpperCase() + id.slice(1);
  const sceneLabel = entry.exportSceneLabel ?? id;
  const drawOptions = entry.exportRenderOptions === false ? ""
    : typeof entry.exportRenderOptions === "function" ? `, ${entry.exportRenderOptions(edit)}`
    : ", {}";
  const prepareStep = entry.prepare
    ? `\n      await window.akari.${entry.browserGlobal}.${entry.prepare}();`
    : "";
  const readyCheck = entry.prepare
    ? `\n        if (window.akari.${entry.browserGlobal}.inspect(${id}Container).status !== 'ready') {\n          throw new Error('${id.toUpperCase()}-RENDER: overlay is not ready');\n        }`
    : "";
  return {
    seekCollector: `\n      const pending${title}Draws = [];`,
    seekBranch: `\n        const ${id}Container = container.querySelector(':scope > .scene-content');\n        if (active && ${id}Container?.querySelector('script[type="application/json"][${entry.declaration.attr}]')) {\n          pending${title}Draws.push([${id}Container, seconds - start]);\n        }`,
    drawStep: `${prepareStep}\n      for (const [${id}Container, localSeconds] of pending${title}Draws) {\n        window.akari.${entry.browserGlobal}.render(${id}Container, localSeconds${drawOptions});${readyCheck}\n      }`,
    readySetup: entry.prepare ? "" : `\n    const ${id}Containers = Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content')).filter((container) =>\n      container.querySelector('script[type="application/json"][${entry.declaration.attr}]')\n    );\n    for (const container of ${id}Containers) {\n      window.akari.${entry.browserGlobal}.render(container, 0);\n    }\n    async function waitFor${title}Container(container) {\n      while (true) {\n        const status = window.akari.${entry.browserGlobal}.inspect(container).status;\n        if (status === 'ready') return;\n        if (status === 'error') {\n          console.error('[akari-${id}] ${sceneLabel} scene の読み込みエラーを fallback 表示のまま続行します');\n          return;\n        }\n        if (status !== 'loading') {\n          console.error('[akari-${id}] ${sceneLabel} scene を初期化できないため fallback 表示のまま続行します', status);\n          return;\n        }\n        await new Promise((resolve) => setTimeout(resolve, 10));\n      }\n    }`,
    readyWait: entry.prepare ? "" : `\n      await Promise.all(${id}Containers.map(waitFor${title}Container));`,
  };
}

export function renderOverlaySheet({ overlays, edit, projectRoot, duration }) {
  const orderedOverlays = orderOverlaysByTrack(overlays).map((overlay) => overlay.htmlPath ? {
    ...overlay,
    html: embedFragmentAssets(overlay.html, { projectRoot, htmlPath: overlay.htmlPath, overlayId: overlay.id }),
  } : overlay);
  const strippedOverlayHtml = orderedOverlays.map((overlay) => stripHtmlComments(overlay.html));
  const hasTextSlotParams = orderedOverlays.some((overlay) =>
    overlay.params && typeof overlay.params === "object" && !Array.isArray(overlay.params)
      && Object.keys(overlay.params).length > 0,
  );
  const activeRuntimes = runtimes.filter(entry => strippedOverlayHtml.some(html => readDeclarations(html, entry).length));
  const usesVideoTextures = activeRuntimes.some(entry => entry.usesVideoTextures);
  const sheetOverlays = orderedOverlays.map(overlay => {
    let html = overlay.html;
    for (const entry of activeRuntimes) {
      if (!readDeclarations(html, entry).length) continue;
      const ctx = { projectRoot, resolveDeclaredProjectInput };
      if (entry.embed) html = entry.embed({ ...overlay, html }, ctx);
      else html = embedRuntimeAssets(html, overlay, entry, ctx);
    }
    return { ...overlay, html };
  });
  const hasResolvedSingleLineCaption = sheetOverlays.some((overlay) =>
    overlay.html.includes("akari-caption--single-line"),
  );
  const nodes = sheetOverlays
    .map((overlay, index) => renderOverlayNode(overlay, index, edit.output.fps))
    .join("\n");
  const hasItemKeyframes = sheetOverlays.some((overlay) => Array.isArray(overlay.keyframes));
  const itemKeyframesRuntimeScripts = hasItemKeyframes
    ? `\n  <script>${inlineScript(readFileSync(
        resolve(SOURCE_DIRECTORY, "../../overlay-runtime/src/keyframes.mjs"),
        "utf8",
      ).replace(/\nexport \{ interpolateKeyframes \};\s*$/u, "\n"))}</script>`
    : "";
  const itemKeyframesSyncBranch = hasItemKeyframes
    ? `
        if (container.hasAttribute('data-akari-keyframes')) {
          const start = Number(container.dataset.start);
          const duration = Number(container.dataset.duration);
          const active = seconds >= start && seconds < start + duration;
          if (active) {
            const points = container.__akariKeyframes ??= JSON.parse(container.dataset.akariKeyframes);
            const statics = container.__akariKeyframeStatics ??= {
              x: Number.parseFloat(container.style.getPropertyValue('--x')),
              y: Number.parseFloat(container.style.getPropertyValue('--y')),
              scale: Number.parseFloat(container.style.getPropertyValue('--scale')),
              rotate: Number.parseFloat(container.style.getPropertyValue('--rotate')),
              opacity: Number(container.dataset.akariOpacity),
            };
            const state = window.akari.keyframes.interpolateKeyframes(
              points,
              Math.max(0, seconds - start) * Number(container.dataset.akariFps),
              { statics },
            );
            const background = container.dataset.akariBackground === 'true';
            container.style.setProperty('--x', background ? '0px' : state.x + 'px');
            container.style.setProperty('--y', background ? '0px' : state.y + 'px');
            container.style.setProperty('--scale', background ? '1' : String(state.scale));
            container.style.setProperty('--rotate', background ? '0deg' : state.rotate + 'deg');
            container.style.setProperty('opacity', String(state.opacity));
          }
        }`
    : "";
  // 断片がモーション語彙（var(--ease-*) / var(--anim-duration-*)）を参照するときだけ
  // 語彙定義を埋め込む。overlays[].vars 経由の参照は container の style 属性に乗るので
  // nodes の文字列検査で両方拾える
  const usesMotionVocabulary = /var\(\s*--(?:ease-|anim-duration-)/u.test(nodes);
  const motionVocabularyStyle = usesMotionVocabulary
    ? `\n  <style>\n${readFileSync(MOTION_VOCAB_CSS_PATH, "utf8")}  </style>`
    : "";
  const exportScripts = new Map();
  for (const entry of activeRuntimes) {
    const declarations = strippedOverlayHtml.flatMap(html => readDeclarations(html, entry).map(d => d.parse()));
    for (const script of entry.scripts) {
      if (declarations.some(descriptor => scriptApplies(script, descriptor))) {
        const path = resolve(runtimeRoot, script.path);
        const source = readFileSync(path, "utf8");
        exportScripts.set(path, script.exportSource ? script.exportSource(source) : source);
      }
    }
  }
  const runtimeScripts = [...exportScripts.values()].map(source => `\n  <script>${inlineScript(source)}</script>`).join("");
  const slotRuntimeScripts = hasTextSlotParams
    ? `\n  <script>${inlineScript(readFileSync(SLOT_PARAMS_PATH, "utf8"))}</script>`
      + `\n  <script>(function(){for(const content of document.querySelectorAll('.akari-overlay-container[data-akari-params] > .scene-content')){const params=JSON.parse(content.parentElement.dataset.akariParams);content.replaceWith(window.akari.slotParams.renderTextSlots(content,params));}})();</script>`
    : "";
  const blocks = activeRuntimes.map(entry => buildRuntimeBlocks(entry, edit));
  const runtimeSeekCollector = blocks.map(block => block.seekCollector).join("");
  const runtimeSeekBranch = blocks.map(block => block.seekBranch).join("");
  const runtimeDrawStep = blocks.map(block => block.drawStep).join("");
  const videoSeekTarget = usesVideoTextures ? "target" : "seconds";
  const videoSeekTargetDeclaration = usesVideoTextures
    ? `\n          const target = video.loop && Number.isFinite(video.duration) && video.duration > 0\n            ? seconds % video.duration\n            : seconds;`
    : "";
  const runtimeReadySetup = blocks.map(block => block.readySetup).join("");
  const runtimeReadyWait = blocks.map(block => block.readyWait).join("");
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
  </style>${motionVocabularyStyle}${itemKeyframesRuntimeScripts}${runtimeScripts}
</head>
<body>
  <div id="stage" data-composition-id="akari-render-cut" data-start="0" data-duration="${formatNumber(duration)}" data-width="${edit.output.width}" data-height="${edit.output.height}" data-fps="${edit.output.fps}" data-no-timeline>
${nodes}${slotRuntimeScripts}
  </div>
  <script>
    // Overlay fragments author entrance animations as plain CSS keyframes, but plain CSS
    // animations cannot survive a the retired renderer render: its producer free-runs this sheet on
    // a virtual clock (so they finish during page setup), and its deterministic CSS adapter
    // re-seeks them to composition time with no clip offset right before every frame
    // capture, baking the fill end state (issue #3). Convert each authored CSS animation
    // into a paused WAAPI clone whose delay absorbs the container's start instead: a write
    // of currentTime = composition time then lands every clone on the correct local frame
    // no matter which writer runs last — __akariSeek (the retired browser writer), the transport hold
    // loop below (the retired renderer), or the retired renderer' own WAAPI adapter. Disabling animation-name
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
              fill: conversion.timing.fill,
            });
            clone.pause();
            clone.currentTime = 0;
          } catch {}
        }
      }
    })();
    window.__akariSyncAnimations = function(seconds) {
      const milliseconds = seconds * 1000;
      for (const container of document.querySelectorAll('.akari-overlay-container')) {${itemKeyframesSyncBranch}
        for (const animation of container.getAnimations({ subtree: true })) {
          try { animation.pause(); } catch {}
          try { animation.currentTime = milliseconds; } catch {}
        }
      }
    };
    // the retired renderer never calls __akariSeek, so follow its transport clock instead. Only the
    // the retired renderer runtime defines window.__player; the the retired browser writer and static-screenshot
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
    // 動画テクスチャのシークだけを切り出した入口。GPU 直描き経路（gpu-export）はこのシートの
    // __akariSeek を呼ばず自前で 3D を描くので、video を進める部分だけをここから呼ぶ。
    // 切り出さないと GPU の 3D 動画テクスチャは 0 秒の絵に固定される（issue #53 (c)）。
    window.__akariSeekVideos = async function(seconds) {
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
      return (await Promise.all(
        Array.from(document.querySelectorAll('video'), waitForVideo),
      )).filter(Boolean);
    };
    window.__akariSeek = async function(seconds) {${runtimeSeekCollector}
      for (const container of document.querySelectorAll('.akari-overlay-container')) {
        const start = Number(container.dataset.start);
        const duration = Number(container.dataset.duration);
        const active = seconds >= start && seconds < start + duration;
        container.style.visibility = active ? 'visible' : 'hidden';
        container.toggleAttribute('data-akari-active', active);${runtimeSeekBranch}
      }
      window.__akariSyncAnimations(seconds);
      const warnings = await window.__akariSeekVideos(seconds);${runtimeDrawStep}
      await Promise.resolve();
      return { warnings };
    };${runtimeReadySetup}
    window.__akariReady = (async function() {
      await document.fonts.ready;${captionFontReadyWait}
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));${runtimeReadyWait}
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
// 進捗欠落として無視する（誤表示より欠落を選ぶ — retired parse_ffmpeg_timestamp と同じ判断）。
export function parseFfmpegOutTime(value) {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

function orderOverlaysByTrack(overlays) {
  return overlays
    .map((overlay, index) => ({ overlay, index }))
    .sort((left, right) => {
      // 契約 §2-5: 字幕を含む全種別を段の z だけで並べ、種別固有の特別規則を置かない。
      const leftZ = Number.isInteger(left.overlay.z) && left.overlay.z >= 0 ? left.overlay.z : 0;
      const rightZ = Number.isInteger(right.overlay.z) && right.overlay.z >= 0 ? right.overlay.z : 0;
      return leftZ - rightZ || left.index - right.index;
    })
    .map(({ overlay }) => overlay);
}

function renderOverlayNode(overlay, index, fps) {
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
  const params = overlay.params && typeof overlay.params === "object" && !Array.isArray(overlay.params)
    && Object.keys(overlay.params).length > 0
    ? ` data-akari-params="${escapeAttribute(JSON.stringify(overlay.params))}"`
    : "";
  const keyframes = Array.isArray(overlay.keyframes)
    ? ` data-akari-keyframes="${escapeAttribute(JSON.stringify(overlay.keyframes))}" data-akari-fps="${formatNumber(fps)}" data-akari-opacity="${formatNumber(overlay.opacity ?? 1)}" data-akari-background="${isBackground}"`
    : "";
  return `    <div class="akari-overlay-container scene clip" data-overlay-id="${escapeAttribute(overlay.id)}" data-start="${formatNumber(overlay.start)}" data-duration="${formatNumber(overlay.duration)}" data-track-index="${index + 1}"${params}${keyframes} style="${escapeAttribute(style)}"><div class="scene-content">${overlay.html}</div></div>`;
}

function embedRuntimeAssets(html, overlay, entry, ctx) {
  return html.replace(new RegExp("<!--[\\s\\S]*?-->|" + declarationPattern(entry).source, "giu"), (match, opening, json, closing) => {
    if (!opening) return match;
    const descriptor = JSON.parse(json);
    for (const reference of entry.assetReferences?.(descriptor, {html, htmlPath:overlay.htmlPath, label:overlay.id}) ?? []) {
      const file = ctx.resolveDeclaredProjectInput(ctx.projectRoot, reference.path, `overlay:${overlay.id}:${reference.role}`);
      const keys = reference.field;
      if (!Array.isArray(keys) || !keys.length || keys.some(key => ["__proto__", "constructor", "prototype"].includes(key))) throw new TypeError("runtime asset reference requires a safe field path");
      const owner = keys.slice(0, -1).reduce((value, key) => value[key], descriptor);
      owner[keys.at(-1)] = `data:${reference.mime ?? "application/octet-stream"};base64,${readFileSync(file).toString("base64")}`;
    }
    return opening + escapeScriptJson(JSON.stringify(descriptor)) + closing;
  });
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
