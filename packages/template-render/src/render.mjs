// render — テンプレート（HTML 断片）を連番 PNG へ焼き、ffmpeg で動画に束ねる。
//
// 決定論が要点。フレームの時刻は壁時計ではなく「フレーム番号 ÷ fps」から作り、
// アニメーションはすべて pause して currentTime を書き込む。同じ入力なら同じ出力になる。

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);

function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch {
    throw new Error(
      "puppeteer-core を読み込めませんでした。パッケージの依存が入っていない可能性があります。\n" +
        "  npm install    をこのパッケージのディレクトリで実行してください。",
    );
  }
}

export function buildHarnessHtml({ fragment, width, height, vars, backdrop, under, transparent }) {
  const background = transparent
    ? "transparent"
    : under
      ? `#000 url("file://${resolve(under).split("\\").join("/")}") center/cover no-repeat`
      : backdrop;

  // AKARI のオーバーレイシートと同じ入れ子（container[inset:0] > .scene-content[inset:0]）を
  // 再現する。ここが本番と違うと、書き出した絵が編集画面と食い違う。
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  .akari-overlay-container { position: absolute; inset: 0; ${vars} }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style></head><body><div id="stage"><div class="akari-overlay-container"><div class="scene-content">${fragment}</div></div></div></body></html>`;
}

/**
 * 見本の文言を差し替える。テキストは CSS 変数ではなく要素テキストとして持つのが規約
 * （文字組を CSS 変数に押し込むと折り返しも装飾も効かなくなる）ため、CLI からは
 * 素直な文字列置換で入れ替える。置換対象が見つからないときは黙って進めず知らせる。
 */
export function applyTextReplacements(html, replacements) {
  let result = html;
  for (const entry of replacements) {
    const at = entry.indexOf("=");
    if (at === -1) throw new Error(`--text は 旧=新 の形式で指定してください: ${entry}`);
    const from = entry.slice(0, at);
    const to = entry.slice(at + 1);
    if (!result.includes(from)) {
      throw new Error(`--text の置換元がテンプレにありません: ${from}`);
    }
    result = result.split(from).join(to);
  }
  return result;
}

export async function shootFrames({
  fragmentPath,
  outDir,
  prefix,
  width,
  height,
  fps,
  frames,
  vars,
  backdrop,
  under,
  transparent,
  chromePath,
  textReplacements = [],
  screenVideo = null,
  screenImage = null,
  onProgress,
}) {
  const puppeteer = loadPuppeteer();
  const fragment = applyTextReplacements(readFileSync(fragmentPath, "utf8"), textReplacements);
  mkdirSync(outDir, { recursive: true });

  const htmlPath = join(outDir, `${prefix}.html`);
  writeFileSync(
    htmlPath,
    buildHarnessHtml({ fragment, width, height, vars, backdrop, under, transparent }),
  );

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "shell",
    args: ["--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-lcd-text"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath.split("\\").join("/")}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    // 画面へ写真・動画を差し込む。差し込み口は素材側が data-akari-slot="screen" で宣言する。
    if (screenVideo || screenImage) {
      const source = `file://${resolve(screenVideo ?? screenImage).split("\\").join("/")}`;
      const placed = await page.evaluate(
        ({ src, isVideo }) => {
          const slot = document.querySelector('[data-akari-slot="screen"]');
          if (!slot) return false;
          const node = document.createElement(isVideo ? "video" : "img");
          node.src = src;
          if (isVideo) {
            node.muted = true;
            node.preload = "auto";
          }
          // 反射やノッチより下、既定のダミー画面より上に置く（先頭挿入 + ダミーは非表示にする）。
          slot.insertBefore(node, slot.firstChild);
          return true;
        },
        { src: source, isVideo: Boolean(screenVideo) },
      );
      if (!placed) {
        throw new Error(
          "この素材には画面の差し込み口がありません（data-akari-slot=\"screen\" を持つ要素が無い）。\n" +
            "写真・動画を入れられるのは画面を持つ素材（スマホ / ノート PC / ブラウザ等）です。",
        );
      }
      if (screenVideo) {
        await page.evaluate(
          () =>
            new Promise((done) => {
              const video = document.querySelector('[data-akari-slot="screen"] video');
              if (!video || video.readyState >= 2) return done();
              video.addEventListener("loadeddata", () => done(), { once: true });
              video.addEventListener("error", () => done(), { once: true });
              setTimeout(done, 8000);
            }),
        );
      }
    }

    for (let index = 0; index < frames; index += 1) {
      await page.evaluate((seconds) => {
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = seconds * 1000;
        }
      }, index / fps);

      // 動画も同じ時刻へシークする。壁時計で再生させないので、何度回しても同じ絵になる。
      if (screenVideo) {
        await page.evaluate(async (seconds) => {
          const video = document.querySelector('[data-akari-slot="screen"] video');
          if (!video) return;
          const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
          // 尺が足りなければ先頭へ巻き戻して繰り返す（素材の尺に合わせて破綻させない）。
          video.currentTime = length ? seconds % length : seconds;
          await new Promise((done) => {
            video.addEventListener("seeked", () => done(), { once: true });
            setTimeout(done, 1000);
          });
        }, index / fps);
      }
      await page.screenshot({
        path: join(outDir, `${prefix}-${String(index).padStart(5, "0")}.png`),
        omitBackground: transparent,
      });
      onProgress?.(index + 1, frames);
    }
  } finally {
    await browser.close();
  }
}

export function encode({ ffmpegPath, pattern, fps, out, alpha }) {
  const args = alpha
    ? ["-y", "-framerate", String(fps), "-i", pattern,
       "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", out]
    : ["-y", "-framerate", String(fps), "-i", pattern,
       "-c:v", "libx264", "-preset", "slow", "-crf", "18",
       "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];

  return new Promise((res, rej) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", rej);
    child.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`ffmpeg が失敗しました（exit ${code}）\n${stderr.slice(-1500)}`)),
    );
  });
}
