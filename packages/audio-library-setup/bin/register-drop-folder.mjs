#!/usr/bin/env node
// ドロップフォルダ監視・登録機構。
//
// ユーザーが手動でダウンロードして置いたファイルを指定フォルダから走査し、
// catalog/audio/candidates.json と照合してファイル単位で以下を行う:
//   - 一致: ~/.akari-video/assets/audio/<id>/ （user スコープ、既存の
//     harvest-asset/setup-library と同じスコープ階層）へ実体を移動 +
//     そこの meta.json（実体あり・remote なし）+ catalog/audio/<id>/meta.json
//     （remote:true・参照専用の SSOT）の両方を用意する
//   - 不一致: ドロップフォルダ内の _quarantine/ へ移動し、manifest.json に
//     「出典不明」として記録する（audio-import レーンと同じ規律）
//
// ハードルール: このスクリプトは一切のネットワークアクセスをしない。処理対象は
// 既にローカルに存在するファイルのみ（実サイトからの自動取得はしない）。
// 既定は plan-only（--apply が無い限りファイルもカタログも一切変更しない）。
//
// Usage:
//   node bin/register-drop-folder.mjs --drop-dir <path> [--apply]
//     [--library-root <path>] [--catalog-dir <path>] [--candidates <path>]

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadCandidates,
    flattenCandidates,
    findMatchingCandidates,
    buildLibraryMeta,
    buildCatalogMeta,
} from '../shared/candidates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']);

function parseArguments(argv) {
    const options = {
        dropDir: path.join(os.homedir(), '.config', 'akari-video', 'audio-drop'),
        libraryRoot: path.join(os.homedir(), '.akari-video', 'assets', 'audio'),
        catalogDir: path.join(repoRoot, 'catalog', 'audio'),
        candidatesPath: path.join(repoRoot, 'catalog', 'audio', 'candidates.json'),
        apply: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--drop-dir') { options.dropDir = path.resolve(argv[++i]); continue; }
        if (arg === '--library-root') { options.libraryRoot = path.resolve(argv[++i]); continue; }
        if (arg === '--catalog-dir') { options.catalogDir = path.resolve(argv[++i]); continue; }
        if (arg === '--candidates') { options.candidatesPath = path.resolve(argv[++i]); continue; }
        if (arg === '--apply') { options.apply = true; continue; }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

async function listDropFiles(dropDir) {
    let entries;
    try {
        entries = await readdir(dropDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const files = [];
    for (const entry of entries) {
        if (entry.name === '_quarantine' || entry.name.startsWith('.')) {
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(ext)) {
            continue;
        }
        files.push(entry.name);
    }
    return files.sort();
}

async function pathExists(candidate) {
    try {
        await stat(candidate);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

let ffmpegAvailableCache;
function ffmpegAvailable() {
    if (ffmpegAvailableCache === undefined) {
        const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        ffmpegAvailableCache = result.status === 0;
    }
    return ffmpegAvailableCache;
}

/**
 * harvest-asset の規律（audio: waveform を preview にする）に従い、library scope の
 * 実体エントリへ preview.png（波形画像）を作る。ffmpeg が無ければ生成せず理由を返す
 * （実物と違う mock を preview として作らない）。
 */
function generateWaveformPreview(sourceAudioPath, destPngPath) {
    if (!ffmpegAvailable()) {
        return { ok: false, reason: 'ffmpeg が見つからないため preview.png を生成できません' };
    }
    const result = spawnSync('ffmpeg', [
        '-y',
        '-i', sourceAudioPath,
        '-filter_complex', 'showwavespic=s=640x120:colors=0d6efd',
        '-frames:v', '1',
        destPngPath,
    ], { stdio: 'ignore' });
    if (result.status !== 0) {
        return { ok: false, reason: `ffmpeg の実行に失敗しました（exit ${result.status}）。音声実体が壊れているか非対応形式の可能性` };
    }
    return { ok: true };
}

async function buildPlan({ dropDir, catalogDir, flatCandidates }) {
    const files = await listDropFiles(dropDir);
    const matchedByCandidateId = new Map();
    const quarantined = [];
    const ambiguous = [];

    for (const filename of files) {
        const matches = findMatchingCandidates(filename, flatCandidates);
        if (matches.length === 0) {
            quarantined.push({ file: filename, reason: '候補のファイル名パターンと一致しない（出典不明）' });
            continue;
        }
        if (matches.length > 1) {
            ambiguous.push({ file: filename, candidates: matches.map((m) => m.id) });
            quarantined.push({
                file: filename,
                reason: `複数候補と一致し一意に決定できない（候補: ${matches.map((m) => m.id).join(', ')}）`,
            });
            continue;
        }
        const item = matches[0];
        if (!matchedByCandidateId.has(item.id)) {
            matchedByCandidateId.set(item.id, { item, files: [] });
        }
        matchedByCandidateId.get(item.id).files.push(filename);
    }

    const matchedGroups = [];
    for (const { item, files: groupFiles } of matchedByCandidateId.values()) {
        const catalogEntryPath = path.join(catalogDir, item.id, 'meta.json');
        matchedGroups.push({
            candidateId: item.id,
            rank: item.rank,
            site: item.site,
            title: item.title_ja,
            files: groupFiles,
            libraryDir: undefined, // filled by caller (needs libraryRoot)
            catalogEntryExists: await pathExists(catalogEntryPath),
            item,
        });
    }

    return { totalFiles: files.length, matchedGroups, quarantined, ambiguousCount: ambiguous.length };
}

async function applyPlan({ plan, dropDir, libraryRoot, catalogDir, categoryLabelByItemId }) {
    const registeredAt = new Date().toISOString().slice(0, 10);
    const results = {
        registered: [],
        skippedDuplicateFiles: [],
        catalogWritten: [],
        catalogSkippedExisting: [],
        quarantinedMoved: [],
        previewGenerated: [],
        previewSkipped: [],
    };

    for (const group of plan.matchedGroups) {
        const libraryDir = path.join(libraryRoot, group.candidateId);
        await mkdir(libraryDir, { recursive: true });

        const movedFiles = [];
        for (const filename of group.files) {
            const src = path.join(dropDir, filename);
            const dest = path.join(libraryDir, filename);
            if (await pathExists(dest)) {
                results.skippedDuplicateFiles.push(filename);
                continue;
            }
            await rename(src, dest);
            movedFiles.push(filename);
        }

        // 過去に登録済みのファイルも合わせて meta.json の収録数へ反映する。
        const existingFiles = (await readdir(libraryDir, { withFileTypes: true }))
            .filter((e) => e.isFile() && e.name !== 'meta.json' && e.name !== 'preview.png')
            .map((e) => e.name)
            .sort();

        const meta = buildLibraryMeta(group.item, categoryLabelByItemId.get(group.candidateId), existingFiles, { registeredAt });
        await writeFile(path.join(libraryDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

        if (movedFiles.length > 0) {
            results.registered.push({ candidateId: group.candidateId, files: movedFiles, libraryDir });
        }

        const previewPath = path.join(libraryDir, 'preview.png');
        if (!(await pathExists(previewPath)) && existingFiles.length > 0) {
            const representative = path.join(libraryDir, existingFiles[0]);
            const previewResult = generateWaveformPreview(representative, previewPath);
            if (previewResult.ok) {
                results.previewGenerated.push(group.candidateId);
            } else {
                results.previewSkipped.push({ candidateId: group.candidateId, reason: previewResult.reason });
            }
        }

        const catalogEntryDir = path.join(catalogDir, group.candidateId);
        const catalogEntryPath = path.join(catalogEntryDir, 'meta.json');
        if (group.catalogEntryExists) {
            results.catalogSkippedExisting.push(group.candidateId);
        } else {
            await mkdir(catalogEntryDir, { recursive: true });
            const catalogMeta = buildCatalogMeta(group.item, categoryLabelByItemId.get(group.candidateId));
            await writeFile(catalogEntryPath, `${JSON.stringify(catalogMeta, null, 2)}\n`, 'utf8');
            results.catalogWritten.push(group.candidateId);
        }
    }

    if (plan.quarantined.length > 0) {
        const quarantineDir = path.join(dropDir, '_quarantine');
        await mkdir(quarantineDir, { recursive: true });
        const manifestPath = path.join(quarantineDir, 'manifest.json');

        let manifest = [];
        if (await pathExists(manifestPath)) {
            try {
                manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
            } catch {
                manifest = [];
            }
        }

        for (const entry of plan.quarantined) {
            const src = path.join(dropDir, entry.file);
            if (!(await pathExists(src))) {
                continue; // 既に前回の実行で隔離済み
            }
            const dest = path.join(quarantineDir, entry.file);
            if (await pathExists(dest)) {
                continue;
            }
            await rename(src, dest);
            results.quarantinedMoved.push(entry.file);
            manifest.push({ file: entry.file, reason: entry.reason, quarantined_at: new Date().toISOString() });
        }

        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    return results;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const data = await loadCandidates(options.candidatesPath);
    const flatCandidates = flattenCandidates(data);
    const categoryLabelByItemId = new Map(flatCandidates.map((item) => [item.id, item.category_label_ja]));

    const plan = await buildPlan({ dropDir: options.dropDir, catalogDir: options.catalogDir, flatCandidates });

    const summary = {
        mode: options.apply ? 'apply' : 'plan-only',
        drop_dir: options.dropDir,
        library_root: options.libraryRoot,
        total_files_scanned: plan.totalFiles,
        matched_candidates: plan.matchedGroups.map((g) => ({
            candidate_id: g.candidateId,
            rank: g.rank,
            site: g.site,
            title: g.title,
            files: g.files,
            catalog_entry_already_exists: g.catalogEntryExists,
        })),
        quarantined: plan.quarantined,
        ambiguous_count: plan.ambiguousCount,
    };

    if (!options.apply) {
        console.log(JSON.stringify(summary, null, 2));
        console.error('(plan-only モード。実際にファイルを動かす・catalog へ書き込むには --apply を付けて再実行してください)');
        return;
    }

    const results = await applyPlan({
        plan,
        dropDir: options.dropDir,
        libraryRoot: options.libraryRoot,
        catalogDir: options.catalogDir,
        categoryLabelByItemId,
    });

    console.log(JSON.stringify({ ...summary, apply_results: results }, null, 2));
}

main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
});
