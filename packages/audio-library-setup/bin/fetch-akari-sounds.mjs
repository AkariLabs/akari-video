#!/usr/bin/env node
// AKARI Sounds（自社 first-party 音源ライブラリ）を GitHub Release から一括取得し、
// user スコープ（~/.akari/assets/audio/akari-sounds-<kind>/）へ登録する。
//
// 第三者配布元と違い AKARI Sounds は自社が配布主体のため、一括ダウンロードを許可する
// （2026-08-03 オーナー裁定。規律の境界は skills/setup-audio-library/first-party.md）。
// 第三者サイト向けのルール（直リンク禁止・直列取得・ユーザー指示必須）はこのスクリプトの
// 対象外だが、取得先は catalog/audio/candidates.json の first_party に宣言された
// AkariLabs/akari-sounds の Release アセットだけに限る（他ホストへは一切アクセスしない）。
//
// Usage: node bin/fetch-akari-sounds.mjs [options]
//   --variant mp3|wav   取得する形式（既定: mp3）
//   --tag <tag>         Release タグ（既定: v0）
//   --dest <dir>        登録先ライブラリルート（既定: ~/.akari/assets/audio）
//   --catalog <path>    catalog.json をローカルファイルから読む（オフライン・検証用）
//   --zips-dir <path>   Release zip をローカルディレクトリから読む（オフライン・検証用）
//   --dry-run           取得せずプランだけ表示する
//   --force             既存ファイルが揃っていても再取得する

import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { generateWaveformPreview } from '../shared/waveform-preview.mjs';
import {
    AKARI_SOUNDS_DEFAULT_TAG,
    buildPackLibraryMeta,
    planFromCatalog,
    rawFileUrl,
    releaseAssetUrl,
    zipAssetNames,
} from '../shared/akari-sounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const validateAssetScript = path.join(repoRoot, 'packages', 'schemas', 'bin', 'validate-asset.mjs');

function parseArguments(argv) {
    const options = {
        variant: 'mp3',
        tag: AKARI_SOUNDS_DEFAULT_TAG,
        // AKARI_HOME はテスト・隔離実行用の差し替え規約（launcher の update-check / sounds-setup と同じ）
        dest: path.join(process.env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'assets', 'audio'),
        catalog: null,
        zipsDir: null,
        dryRun: false,
        force: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--variant') { options.variant = argv[++i]; continue; }
        if (arg === '--tag') { options.tag = argv[++i]; continue; }
        if (arg === '--dest') { options.dest = path.resolve(argv[++i]); continue; }
        if (arg === '--catalog') { options.catalog = path.resolve(argv[++i]); continue; }
        if (arg === '--zips-dir') { options.zipsDir = path.resolve(argv[++i]); continue; }
        if (arg === '--dry-run') { options.dryRun = true; continue; }
        if (arg === '--force') { options.force = true; continue; }
        throw new Error(`Unknown option: ${arg}`);
    }
    zipAssetNames(options.variant); // variant の妥当性を先に検証（不正なら throw）
    return options;
}

async function loadCatalog(options) {
    if (options.catalog) {
        return JSON.parse(await readFile(options.catalog, 'utf8'));
    }
    const url = rawFileUrl('catalog.json', options.tag);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`catalog.json の取得に失敗: ${url} → HTTP ${res.status}`);
    }
    return res.json();
}

async function fileExists(filePath) {
    try {
        const info = await stat(filePath);
        return info.isFile() && info.size > 0;
    } catch {
        return false;
    }
}

/** pack ごとに、登録先にまだ無いファイルを列挙する */
async function computeMissing(plan, dest) {
    const missing = new Map();
    for (const pack of plan.packs) {
        const packDir = path.join(dest, pack.id);
        const absent = [];
        for (const name of pack.files) {
            if (!(await fileExists(path.join(packDir, name)))) {
                absent.push(name);
            }
        }
        missing.set(pack.id, absent);
    }
    return missing;
}

async function downloadToFile(url, destPath) {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
        throw new Error(`ダウンロード失敗: ${url} → HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

function unzipInto(zipPath, extractDir) {
    const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') {
        throw new Error('unzip コマンドが見つかりません。unzip を導入するか、Release zip を手動展開して --zips-dir ではなく登録先へ直接置いてください');
    }
    if (result.status !== 0) {
        throw new Error(`unzip 失敗 (${zipPath}): ${result.stderr || result.stdout}`);
    }
}

/** 展開ディレクトリ以下を再帰走査し、ファイル名（basename）→ 絶対パスの索引を作る */
async function indexExtractedFiles(rootDir) {
    const index = new Map();
    const entries = await readdir(rootDir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        index.set(entry.name, path.join(entry.parentPath, entry.name));
    }
    return index;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const catalog = await loadCatalog(options);
    const plan = planFromCatalog(catalog, { variant: options.variant });
    const zipNames = zipAssetNames(options.variant);

    console.log(`AKARI Sounds 一括取得（${plan.library} ${plan.version ?? ''} / ${options.variant} / tag ${options.tag}）`);
    for (const pack of plan.packs) {
        console.log(`  ${pack.id}: ${pack.trackCount} トラック / ${pack.takeCount} テイク`);
    }
    console.log(`  登録先: ${options.dest}`);

    const missingBefore = await computeMissing(plan, options.dest);
    const totalMissing = [...missingBefore.values()].reduce((n, list) => n + list.length, 0);

    if (options.dryRun) {
        for (const name of zipNames) {
            console.log(`  取得予定 zip: ${options.zipsDir ? path.join(options.zipsDir, name) : releaseAssetUrl(name, options.tag)}`);
        }
        console.log(`dry-run: 未取得 ${totalMissing} / ${plan.totalFiles} ファイル。ここで終了（ダウンロードなし）`);
        return;
    }

    if (totalMissing === 0 && !options.force) {
        console.log('全ファイル取得済み。ダウンロードをスキップし meta.json だけ更新します（再取得は --force）');
    } else {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'akari-sounds-fetch-'));
        try {
            const extractDir = path.join(tempRoot, 'extract');
            await mkdir(extractDir, { recursive: true });
            for (const name of zipNames) {
                let zipPath;
                if (options.zipsDir) {
                    zipPath = path.join(options.zipsDir, name);
                } else {
                    zipPath = path.join(tempRoot, name);
                    const url = releaseAssetUrl(name, options.tag);
                    console.log(`  ダウンロード中: ${url}`);
                    await downloadToFile(url, zipPath);
                }
                unzipInto(zipPath, extractDir);
            }
            const extractedIndex = await indexExtractedFiles(extractDir);

            for (const pack of plan.packs) {
                const packDir = path.join(options.dest, pack.id);
                await mkdir(packDir, { recursive: true });
                let placed = 0;
                const notInZip = [];
                for (const name of pack.files) {
                    const from = extractedIndex.get(name);
                    if (!from) {
                        notInZip.push(name);
                        continue;
                    }
                    const to = path.join(packDir, name);
                    if (options.force || !(await fileExists(to))) {
                        await copyFile(from, to);
                        placed += 1;
                    }
                }
                console.log(`  ${pack.id}: ${placed} ファイル配置${notInZip.length ? ` / zip 内に見つからず ${notInZip.length} 件: ${notInZip.slice(0, 5).join(', ')}${notInZip.length > 5 ? ' …' : ''}` : ''}`);
            }
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    }

    // meta.json + 取得時点のカタログスナップショット（生成記録の来歴）を毎回書き直す。
    // preview.png は harvest-asset の規律どおり実波形から生成する（代表 = パック先頭ファイル。
    // ffmpeg が無い等で作れないときは実物と違う mock を作らず、理由を記録して正直にスキップ —
    // register-drop-folder と同じ規律）
    const fetchedAt = new Date().toISOString().slice(0, 10);
    const previewSkipped = new Map();
    for (const pack of plan.packs) {
        const packDir = path.join(options.dest, pack.id);
        await mkdir(packDir, { recursive: true });
        const meta = buildPackLibraryMeta(pack, { tag: options.tag, fetchedAt });
        await writeFile(path.join(packDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
        await writeFile(path.join(packDir, '.origin-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
        const previewPath = path.join(packDir, 'preview.png');
        if (options.force || !(await fileExists(previewPath))) {
            const representative = pack.files.find((name) => name);
            const previewResult = representative
                ? generateWaveformPreview(path.join(packDir, representative), previewPath)
                : { ok: false, reason: 'パックにファイルがありません' };
            if (!previewResult.ok) {
                previewSkipped.set(pack.id, previewResult.reason);
                console.error(`  preview.png 未生成 ${pack.id}: ${previewResult.reason}`);
            }
        }
    }

    // 検収: 期待ファイルの欠品と meta.json のスキーマ妥当性
    const missingAfter = await computeMissing(plan, options.dest);
    let incomplete = 0;
    for (const pack of plan.packs) {
        const absent = missingAfter.get(pack.id) ?? [];
        if (absent.length > 0) {
            incomplete += absent.length;
            console.error(`  欠品 ${pack.id}: ${absent.length} 件（例: ${absent.slice(0, 5).join(', ')}）`);
        }
        const result = spawnSync(process.execPath, [validateAssetScript, path.join(options.dest, pack.id)], { encoding: 'utf8' });
        if (result.status !== 0) {
            const output = `${result.stderr ?? ''}${result.stdout ?? ''}`;
            const failureLines = output.split('\n').filter((line) => line.startsWith('- '));
            const onlyPreviewMissing = previewSkipped.has(pack.id)
                && failureLines.length > 0
                && failureLines.every((line) => line.includes('preview.png'));
            if (onlyPreviewMissing) {
                // 音源の実体は揃っている。preview は正直スキップ済みなので致命扱いにしない
                // （register-drop-folder の「honestly skipped」と同じ扱い）
                console.error(`  検証注記 ${pack.id}: preview.png 未生成のため validate-asset は不合格（${previewSkipped.get(pack.id)}）。音源は配置済み — ffmpeg 導入後に --force で再生成できます`);
            } else {
                incomplete += 1;
                console.error(`  validate-asset 失敗 ${pack.id}: ${output}`);
            }
        }
    }

    if (incomplete > 0) {
        console.error(`未完了: ${incomplete} 件の欠品/検証失敗があります`);
        process.exitCode = 1;
        return;
    }
    console.log(`完了: ${plan.totalFiles} ファイル / ${plan.packs.length} パックを登録済み（${options.dest}）`);
}

main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
});
