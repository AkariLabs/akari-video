import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

import { findChrome } from "../../../akari-tools/bin/avatar-vrm/find-chrome.mjs";
import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";

const FONT_CANDIDATES = [
  "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const exists = (path) => access(path).then(() => true, () => false);
const escapeDrawtext = (value) => String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "’").replaceAll("%", "％");
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

let crcTable;
function crc32(buffer) {
  crcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function solidPng(width, height) {
  const row = Buffer.alloc(1 + width * 3);
  for (let offset = 1; offset < row.length; offset += 3) {
    row[offset] = 0x20;
    row[offset + 1] = 0x20;
    row[offset + 2] = 0x20;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function defaultLoadPuppeteer() {
  try {
    const loaded = await import("puppeteer-core");
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

function cardHtml({ id, name, prompt, width, height }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #202020; }
body { color: white; font-family: "Hiragino Sans", "Noto Sans CJK JP", sans-serif; }
main { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.id { margin-bottom: 22px; color: rgba(255,255,255,.72); font-size: 28px; font-weight: 400; letter-spacing: .08em; }
.name { max-width: 86%; color: #fff; font-size: 76px; font-weight: 700; line-height: 1.3; }
.prompt { max-width: 76%; margin-top: 30px; color: rgba(255,255,255,.58); font-size: 30px; font-weight: 300; line-height: 1.5; }
footer { position: absolute; right: 52px; bottom: 38px; color: rgba(255,255,255,.52); font-size: 24px; font-weight: 300; }
</style></head><body data-width="${width}" data-height="${height}"><main><div class="id">${escapeHtml(id)}</div><div class="name">${escapeHtml(name)}</div><div class="prompt">${escapeHtml(String(prompt ?? "").slice(0, 60))}</div></main><footer>planned · 文字カード</footer></body></html>`;
}

async function renderWithChrome({ id, name, prompt, outPath, width, height, loadPuppeteer, resolveChrome }) {
  let browser;
  try {
    const puppeteer = await loadPuppeteer();
    if (!puppeteer?.launch) return false;
    const executablePath = await resolveChrome();
    if (!executablePath) return false;
    const isHeadlessShell = /(?:^|[/\\])chrome-headless-shell(?:\.exe)?$/.test(executablePath);
    browser = await puppeteer.launch({
      executablePath,
      headless: isHeadlessShell ? "shell" : true,
      pipe: isHeadlessShell,
      protocolTimeout: 600_000,
      args: [
        "--no-sandbox",
        ...(isHeadlessShell ? ["--single-process", "--no-zygote"] : []),
        "--disable-gpu",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(cardHtml({ id, name, prompt, width, height }), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath, type: "png", captureBeyondViewport: false });
    return true;
  } catch {
    return false;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function renderWithDrawtext({ id, name, prompt, outPath, width, height, env, spawn, resolveBinary, fontCandidates }) {
  let ffmpeg;
  try {
    ffmpeg = resolveBinary({ env });
  } catch {
    return false;
  }
  const font = (await Promise.all(fontCandidates.map(async (path) => await exists(path) ? path : null))).find(Boolean);
  if (!font) return false;
  const filters = [
    `drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(id)}':fontcolor=white@0.72:fontsize=28:x=(w-text_w)/2:y=h/2-100`,
    `drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(name)}':fontcolor=white:fontsize=76:x=(w-text_w)/2:y=h/2-35`,
    `drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(String(prompt ?? "").slice(0, 60))}':fontcolor=white@0.58:fontsize=30:x=(w-text_w)/2:y=h/2+75`,
    `drawtext=fontfile='${escapeDrawtext(font)}':text='planned · 文字カード':fontcolor=white@0.52:fontsize=24:x=w-text_w-52:y=h-text_h-38`,
  ];
  try {
    const result = spawn(ffmpeg, [
      "-y", "-f", "lavfi", "-i", `color=c=0x202020:s=${width}x${height}`,
      "-frames:v", "1", "-vf", filters.join(","), outPath,
    ], { encoding: "utf8", env });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export async function renderTextCard({
  id,
  name,
  prompt,
  outPath,
  width = 1920,
  height = 1080,
  env = process.env,
  spawn = spawnSync,
  loadPuppeteer = defaultLoadPuppeteer,
  resolveChrome = findChrome,
  resolveBinary = resolveFfmpeg,
  fontCandidates = FONT_CANDIDATES,
  logRenderer = (line) => console.error(line),
}) {
  await mkdir(dirname(outPath), { recursive: true });
  if (await renderWithChrome({ id, name, prompt, outPath, width, height, loadPuppeteer, resolveChrome })) {
    logRenderer(`文字カード ${id}: renderer=chrome`);
    return { path: outPath, renderer: "chrome" };
  }
  if (await renderWithDrawtext({ id, name, prompt, outPath, width, height, env, spawn, resolveBinary, fontCandidates })) {
    logRenderer(`文字カード ${id}: renderer=ffmpeg-drawtext`);
    return { path: outPath, renderer: "ffmpeg-drawtext" };
  }
  await writeFile(outPath, solidPng(width, height));
  logRenderer(`WARN: 文字カード ${id} は文字なしの単色カードにしました: renderer=solid`);
  return { path: outPath, renderer: "solid" };
}
