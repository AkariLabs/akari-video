#!/usr/bin/env node
// フォントカタログの見本画像レンダラー。
//
// 1200x675 の PNG を catalog/font/<id>/preview.png に生成する。1 行目はフォント名をその書体
// 自身で、2 行目は固定見本文（字形が欠ける書体だけ個別に調整・SAMPLE_OVERRIDES に記録）で組む。
//
// 対象は 3 種類:
//   - bundled  : 実体が assets/font/<id>/ に同梱済み（そのまま file:// 参照）
//   - download : 無料で直接取得できる書体。取得元 URL をこのファイルに記録し、実行のたびに
//                一時ディレクトリへ取得する（フォントファイルはリポジトリにコミットしない）
//   - skip     : ログイン/会員登録必須 or 配布 URL が死亡している書体。pending として記録し、
//                レンダリングをスキップする（黙って落とさない）
//
// 依存: playwright / adm-zip はリポジトリルートの devDependencies（本 worktree に
// node_modules が無ければ `npm ci` するか、インストール済みの別チェックアウトの
// node_modules を一時的にシンボリックリンクする）。corporate-logo-rounded の
// postProcess（stripCmapFormat14）だけ追加で `uv`（fonttools 実行用）が必要
//
// 使い方:
//   node scripts/render-font-specimens.mjs                 # 対象全件をレンダリング
//   node scripts/render-font-specimens.mjs --only=id1,id2   # 指定 id だけ再レンダリング
//   node scripts/render-font-specimens.mjs --list-skipped   # skip 一覧だけ表示して終了

import { chromium } from "playwright";
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cacheDir = path.join(os.tmpdir(), "akari-font-specimens-cache");

const DEFAULT_SAMPLE = "あア亜 永久 憂鬱 AKARI 123";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// ---------------------------------------------------------------------------
// マニフェスト
// ---------------------------------------------------------------------------

const FONT_MANIFEST = [
  // --- 同梱 9 家族（実体: assets/font/<id>/） -------------------------------
  { id: "noto-sans-jp", title: "Noto Sans JP", kind: "bundled", file: "assets/font/noto-sans-jp/NotoSansJP-Variable.ttf" },
  { id: "mplus-rounded-1c", title: "M PLUS Rounded 1c", kind: "bundled", file: "assets/font/mplus-rounded-1c/MPLUSRounded1c-Medium.ttf" },
  { id: "noto-serif-jp", title: "Noto Serif JP", kind: "bundled", file: "assets/font/noto-serif-jp/NotoSerifJP-Variable.ttf" },
  { id: "biz-udgothic", title: "BIZ UDGothic", kind: "bundled", file: "assets/font/biz-udgothic/BIZUDGothic-Regular.ttf" },
  { id: "dela-gothic-one", title: "Dela Gothic One", kind: "bundled", file: "assets/font/dela-gothic-one/DelaGothicOne-Regular.ttf" },
  { id: "zen-maru-gothic", title: "Zen Maru Gothic", kind: "bundled", file: "assets/font/zen-maru-gothic/ZenMaruGothic-Regular.ttf" },
  { id: "shippori-mincho", title: "Shippori Mincho", kind: "bundled", file: "assets/font/shippori-mincho/ShipporiMincho-Regular.ttf" },
  { id: "dotgothic16", title: "DotGothic16", kind: "bundled", file: "assets/font/dotgothic16/DotGothic16-Regular.ttf" },
  { id: "klee-one", title: "Klee One", kind: "bundled", file: "assets/font/klee-one/KleeOne-Regular.ttf" },

  // --- 直接 DL できる無料 10 件のうち成功した 9 件 ---------------------------
  // Google Fonts 3 件は google/fonts の GitHub raw から取得（fonts.google.com/download は
  // 2026-08 時点で HTML を返すだけになっており使えない。ofl/<slug>/<Family>-Regular.ttf）
  {
    id: "rocknroll-one",
    title: "RocknRoll One",
    kind: "download",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/rocknrollone/RocknRollOne-Regular.ttf",
    filename: "RocknRollOne-Regular.ttf",
  },
  {
    id: "reggae-one",
    title: "Reggae One",
    kind: "download",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/reggaeone/ReggaeOne-Regular.ttf",
    filename: "ReggaeOne-Regular.ttf",
  },
  {
    id: "mplus-1p",
    title: "M PLUS 1p",
    kind: "download",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/mplus1p/MPLUS1p-Regular.ttf",
    filename: "MPLUS1p-Regular.ttf",
  },
  {
    // jikasei.me の配布 zip には genjyuugothic 系含む複数ファミリー・複数ウェイトが同梱される。
    // mgenplus-1p-regular.ttf（プロポーショナル・Regular）を採用
    id: "mgen-plus",
    title: "Mgen+（ムゲンプラス）",
    kind: "download",
    url: "https://ftp.iij.ad.jp/pub/osdn.jp/users/8/8593/mgenplus-1-20150602.zip",
    zipEntryMatch: /mgenplus-1p-regular\.ttf$/i,
    filename: "MgenPlus1p-Regular.ttf",
  },
  {
    // 配布元 OTF の cmap format 14（異体字セレクタ）サブテーブルが Unicode 値の順序異常を
    // 持っており、Chromium の OTS（OpenType Sanitizer）が "Failed to decode downloaded font"
    // としてロード自体を拒否する（2026-08-06 確認）。異体字セレクタは見本レンダリングに不要なため、
    // fonttools でそのサブテーブルだけ除去した複製をレンダリングに使う（postProcess 参照）
    id: "corporate-logo-rounded",
    title: "コーポレート・ロゴ（ラウンド）ver3",
    kind: "download",
    url: "https://logotype.jp/wp-content/uploads/2022/10/Corporate-Logo-Rounded-Bold-ver3.zip",
    zipEntryMatch: /Corporate-Logo-Rounded-Bold-ver3\.otf$/i,
    filename: "CorporateLogoRoundedBold-ver3.otf",
    postProcess: "stripCmapFormat14",
  },
  {
    // pm85122.onamae.jp 上のバージョン一覧のうち最新版（Ver0.04 KanaA）を採用
    id: "851-chikara-dzuyoku",
    title: "851チカラヅヨク",
    kind: "download",
    url: "https://pm85122.onamae.jp/851CHIKARA-DZUYOKU_kanaA_004.ttf",
    filename: "851CHIKARA-DZUYOKU_kanaA_004.ttf",
  },
  {
    id: "851-chikara-yowaku",
    title: "851チカラヨワク",
    kind: "download",
    url: "https://pm85122.onamae.jp/851CHIKARA-YOWAKU_002.ttf",
    filename: "851CHIKARA-YOWAKU_002.ttf",
  },
  {
    // zip 内のフォント実体は "CP and Trans.otf"（チェッカー柄+横断歩道柄 = Check pattern and
    // Transverse stripes の略と推定。配布元ページのタイトルと一致する唯一の同梱フォント）
    id: "check-and-oudan",
    title: "チェックアンド横断フォント",
    kind: "download",
    url: "https://cute-freefont.flop.jp/dl/cpandtrans_ote.zip",
    zipEntryMatch: /CP and Trans\.otf$/i,
    filename: "CheckAndOudan.otf",
  },
  {
    // zip 内に同名だが収録文字の少ない旧版が other-サポート外/ 配下にもあるため、直下の
    // ラノベPOP.otf（フル版）だけを対象にする
    id: "ranobe-pop",
    title: "07ラノベPOP",
    kind: "download",
    url: "http://www.fontna.com/font/LightNovelPOP_FONT.zip",
    zipEntryMatch: /^LightNovelPOP_FONT\/ラノベPOP\.otf$/,
    filename: "RanobePOP.otf",
  },

  // --- skip（ログイン/会員登録必須・確認済み） --------------------------------
  {
    id: "zero-gothic",
    title: "零ゴシック",
    kind: "skip",
    reason:
      "BOOTH（flopdesign.booth.pm/items/2658538）。価格 ¥0 だが「無料ダウンロード」ボタンの " +
      "downloadables エンドポイント（https://booth.pm/downloadables/1554279?variation_id=4365136）は " +
      "未ログインだと BOOTH ログイン画面へリダイレクトされることを確認済み（2026-08-06）。ログイン不要での取得不可",
  },
  {
    id: "isego",
    title: "異世ゴ",
    kind: "skip",
    reason:
      "BOOTH（booth.pm/ja/items/2291468）。同上パターンで確認済み — " +
      "downloadables エンドポイント（https://booth.pm/downloadables/6373356?variation_id=3732614）も " +
      "未ログインだとログイン画面へリダイレクト（2026-08-06）",
  },
  {
    id: "wanpaku-ruika",
    title: "わんぱくルイカ（無料お試し版）",
    kind: "skip",
    reason:
      "フリーフォントケンサク（cute-freefont.flop.jp）のダウンロードリンクは配布元 www.type-labo.jp の " +
      "トップページに遷移するのみで、個別の直接 DL リンクが無い。type-labo.jp はメールアドレス登録制の " +
      "配布サイトのため、ログイン不要での自動取得は不可（2026-08-06 確認）",
  },
  {
    id: "ruika",
    title: "ルイカ（無料お試し版）",
    kind: "skip",
    reason: "wanpaku-ruika と同一の理由（www.type-labo.jp・メールアドレス登録制、2026-08-06 確認）",
  },
  {
    id: "togebara",
    title: "棘薔薇フォント",
    kind: "skip",
    reason:
      "配布元ページ記載の一次 URL（https://fontgraphic.jp/fgtogebara）が 404。" +
      "検索で見つけた代替 URL（https://fontgraphic.jp/download/fgtogebara/）も 404（2026-08-06 確認、" +
      "1 回だけの代替探索の範囲でダメだったため skip）",
  },
];

// 字形欠け（豆腐/フォールバック）が目視で確認された書体だけの見本文差し替え。
// 各エントリに理由を記録する（2026-08-06 目視確認）。
const SAMPLE_OVERRIDES = {
  // (レンダリング後の目視確認で追記する。初期状態では空。)
};

// ---------------------------------------------------------------------------
// レンダリング本体
// ---------------------------------------------------------------------------

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function fetchToFile(url, destPath) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`fetch failed: ${url} -> HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureDir(path.dirname(destPath));
  await fs.promises.writeFile(destPath, buf);
  return destPath;
}

// fonttools（uv 経由）で cmap format 14 サブテーブルだけを取り除いた複製を作る。
// 異体字セレクタは見本文レンダリングに不要 & 配布元ファイルの構造異常を回避するための処置。
async function stripCmapFormat14(srcPath) {
  const outPath = srcPath.replace(/(\.[^.]+)$/, ".fixed$1");
  if (fs.existsSync(outPath)) return outPath;
  const script = `
from fontTools.ttLib import TTFont
f = TTFont(${JSON.stringify(srcPath)})
cmap = f["cmap"]
cmap.tables = [t for t in cmap.tables if t.format != 14]
f.save(${JSON.stringify(outPath)})
`;
  await execFileAsync("uv", ["run", "--with", "fonttools", "python3", "-c", script]);
  return outPath;
}

const POST_PROCESSORS = {
  stripCmapFormat14,
};

async function resolveFontFile(entry) {
  if (entry.kind === "bundled") {
    const abs = path.join(repoRoot, entry.file);
    if (!fs.existsSync(abs)) throw new Error(`bundled font not found: ${abs}`);
    return abs;
  }

  if (entry.kind === "download") {
    const idCacheDir = path.join(cacheDir, entry.id);
    let destPath = path.join(idCacheDir, entry.filename);

    if (!fs.existsSync(destPath)) {
      if (entry.zipEntryMatch) {
        const zipPath = path.join(idCacheDir, "source.zip");
        await fetchToFile(entry.url, zipPath);
        const zip = new AdmZip(zipPath);
        const match = zip.getEntries().find((e) => entry.zipEntryMatch.test(e.entryName));
        if (!match) {
          throw new Error(`zip entry not found matching ${entry.zipEntryMatch} in ${entry.url}`);
        }
        await fs.promises.writeFile(destPath, match.getData());
      } else {
        await fetchToFile(entry.url, destPath);
      }
    }

    if (entry.postProcess) {
      const processor = POST_PROCESSORS[entry.postProcess];
      if (!processor) throw new Error(`unknown postProcess: ${entry.postProcess}`);
      destPath = await processor(destPath);
    }

    return destPath;
  }

  throw new Error(`unsupported kind: ${entry.kind}`);
}

function buildHtml({ fontUrl, format, title, sampleText }) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @font-face {
    font-family: "SpecimenFont";
    src: url("${fontUrl}") format("${format}");
  }
  html, body {
    margin: 0; padding: 0;
    width: 1200px; height: 675px;
    background: #f7f5f0;
  }
  .wrap {
    box-sizing: border-box;
    width: 1200px; height: 675px;
    display: flex; flex-direction: column;
    justify-content: center;
    padding: 0 80px;
  }
  .name {
    font-family: "SpecimenFont", sans-serif;
    font-size: 64px;
    line-height: 1.3;
    color: #1a1a1a;
    white-space: nowrap;
  }
  .sample {
    font-family: "SpecimenFont", sans-serif;
    font-size: 88px;
    line-height: 1.3;
    color: #1a1a1a;
    margin-top: 28px;
    white-space: nowrap;
  }
</style></head>
<body>
  <div class="wrap">
    <div class="name">${escape(title)}</div>
    <div class="sample">${escape(sampleText)}</div>
  </div>
  <script>
    // 見本文の横幅は書体ごとに大きく変わる（等幅寄り〜プロポーショナル、装飾書体など）。
    // 省略記号で見切れさせず全文を見せるため、はみ出す場合はフォントサイズを縮めてフィットさせる。
    async function fitToWidth(el, maxWidth, minSizePx) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > maxWidth && size > minSizePx) {
        size -= 2;
        el.style.fontSize = size + "px";
      }
    }
    (async () => {
      await document.fonts.ready;
      const wrap = document.querySelector(".wrap");
      const wrapStyle = getComputedStyle(wrap);
      // .wrap は box-sizing: border-box なので clientWidth には左右 padding が含まれる。
      // 子要素が使える実幅は padding を差し引いた content box 幅
      const contentWidth =
        wrap.clientWidth - parseFloat(wrapStyle.paddingLeft) - parseFloat(wrapStyle.paddingRight);
      fitToWidth(document.querySelector(".name"), contentWidth, 24);
      fitToWidth(document.querySelector(".sample"), contentWidth, 32);
      window.__fitDone = true;
    })();
  </script>
</body></html>`;
}

function formatOf(filePath) {
  return /\.otf$/i.test(filePath) ? "opentype" : "truetype";
}

async function renderOne(browser, entry) {
  const fontPath = await resolveFontFile(entry);
  const fontUrl = "file://" + fontPath;
  const sampleText = SAMPLE_OVERRIDES[entry.id] ?? DEFAULT_SAMPLE;
  const html = buildHtml({ fontUrl, format: formatOf(fontPath), title: entry.title, sampleText });

  // about:blank / data: origin のページから file:// リソースを参照すると Chromium のセキュリティ
  // 制限でブロックされるため、HTML 自体を一時ファイルへ書いて file:// origin から開く
  const htmlPath = path.join(cacheDir, `${entry.id}.html`);
  await ensureDir(cacheDir);
  await fs.promises.writeFile(htmlPath, html, "utf8");

  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await page.goto("file://" + htmlPath, { waitUntil: "load" });
  // フォールバック描画の混入を避けるため @font-face のロード完了を待ち、
  // さらにページ内スクリプトの横幅フィット（省略記号回避）完了を待つ
  await page.waitForFunction(() => document.fonts.check('64px "SpecimenFont"'));
  await page.waitForFunction(() => window.__fitDone === true);

  const outDir = path.join(repoRoot, "catalog", "font", entry.id);
  await ensureDir(outDir);
  const outPath = path.join(outDir, "preview.png");
  await page.screenshot({ path: outPath });
  await page.close();
  return outPath;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyIds = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
  const listSkippedOnly = args.includes("--list-skipped");

  const skipped = FONT_MANIFEST.filter((e) => e.kind === "skip");
  if (listSkippedOnly) {
    for (const e of skipped) console.log(`${e.id}\t${e.reason}`);
    return;
  }

  const targets = FONT_MANIFEST.filter((e) => e.kind !== "skip" && (!onlyIds || onlyIds.has(e.id)));

  await ensureDir(cacheDir);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const entry of targets) {
      try {
        const outPath = await renderOne(browser, entry);
        results.push({ id: entry.id, ok: true, outPath });
        console.log(`OK   ${entry.id} -> ${path.relative(repoRoot, outPath)}`);
      } catch (error) {
        results.push({ id: entry.id, ok: false, error: error.message });
        console.error(`FAIL ${entry.id}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== skip (pending) ===");
  for (const e of skipped) console.log(`${e.id}\t${e.reason}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} 件のレンダリングに失敗しました`);
    process.exitCode = 1;
  }
}

main();
