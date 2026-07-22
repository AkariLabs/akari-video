// catalog/audio/candidates.json の読み込み・正規化・マッチング判定を担う共有ロジック。
// generate-candidates-html.mjs と register-drop-folder.mjs の両方から読む（重複実装しない）。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} candidatesPath catalog/audio/candidates.json の絶対パス
 */
export async function loadCandidates(candidatesPath) {
    const raw = await readFile(candidatesPath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.categories)) {
        throw new Error('candidates.json: categories 配列がありません');
    }
    return data;
}

/**
 * categories[].items[] を、所属カテゴリの id/label を付けたフラット配列にする。
 */
export function flattenCandidates(data) {
    const flat = [];
    for (const category of data.categories) {
        for (const item of category.items) {
            flat.push({ ...item, category_id: category.id, category_label_ja: category.label_ja });
        }
    }
    flat.sort((a, b) => a.rank - b.rank);
    return flat;
}

/**
 * ファイル名（拡張子込み・拡張子なしどちらでも可）を比較用に正規化する。
 * 小文字化 + 拡張子除去 + 空白/アンダースコアをハイフンへ寄せる。
 */
export function normalizeStem(filename) {
    const base = path.basename(filename);
    const withoutExt = base.replace(/\.[a-zA-Z0-9]+$/, '');
    return withoutExt
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
}

/**
 * 1件の候補（expected_filenames / filename_patterns）に対して、正規化済みファイル名 stem が
 * 一致するかを判定する。一致すれば true。BGM の songs[]（個別曲。多くは expected_filenames が
 * 未確定=空のまま——サイトの表示タイトルからは実ファイル名を確定できないため、分かる範囲でのみ
 * 埋める設計）も合わせて見る。songs[] 内で一致した場合も、登録は親candidate（パックのフォルダ）
 * 単位で行う。
 */
export function stemMatchesCandidate(stem, item) {
    for (const expected of item.expected_filenames ?? []) {
        if (normalizeStem(expected) === stem) {
            return true;
        }
    }
    for (const pattern of item.filename_patterns ?? []) {
        const prefix = normalizeStem(pattern.prefix);
        if (!stem.startsWith(prefix)) {
            continue;
        }
        const suffix = stem.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) {
            continue;
        }
        const n = Number(suffix);
        if (n >= pattern.min && n <= pattern.max) {
            return true;
        }
    }
    for (const song of item.songs ?? []) {
        for (const expected of song.expected_filenames ?? []) {
            if (normalizeStem(expected) === stem) {
                return true;
            }
        }
    }
    return false;
}

/**
 * BGM の songs[] を含め、候補 1 件に属する「曲・音源の個数」を数える。songs[] が無い候補
 * （SFX の大半、および BGM の検索/参照ページ等）は 1 件として数える。
 */
export function countUnits(item) {
    return item.songs?.length ?? 1;
}

/**
 * 候補 1 件の mood を、item 直下の mood[] と songs[] 内の各曲の mood を合わせた集合として返す
 * （曲ごとに mood が異なる BGM パックのカバレッジ集計・表示に使う）。
 */
export function collectMoods(item) {
    const moods = new Set(item.mood ?? []);
    for (const song of item.songs ?? []) {
        for (const mood of song.mood ?? []) {
            moods.add(mood);
        }
    }
    return [...moods];
}

/**
 * 1 ファイル名に対して、フラット化した候補配列から一致する候補をすべて返す
 * （expected_filenames が重複する設計は想定していないため通常 0〜1 件）。
 */
export function findMatchingCandidates(filename, flatCandidates) {
    const stem = normalizeStem(filename);
    return flatCandidates.filter((item) => stemMatchesCandidate(stem, item));
}

/**
 * hostname を取り出す。不正な URL は null を返す（例外を投げない = 呼び出し側の走査を止めない）。
 */
export function hostnameOf(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

/**
 * catalog/audio/<id>/meta.json をすべて読み、各エントリの id・source.url を集める。
 * candidates.json 自身や INDEX.md はスキップする。既存カタログの構造を変更しない読み取り専用処理。
 */
export async function scanCatalogAudio(catalogAudioDir) {
    let entries;
    try {
        entries = await readdir(catalogAudioDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const results = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const metaPath = path.join(catalogAudioDir, entry.name, 'meta.json');
        let meta;
        try {
            meta = JSON.parse(await readFile(metaPath, 'utf8'));
        } catch {
            continue;
        }
        results.push({ dirName: entry.name, meta });
    }
    return results;
}

/**
 * 候補ごとに「既所有」状態を動的に判定する。audio-import 等、他レーンの登録分が catalog/audio に
 * 増えても再実行するだけで反映される（ハードコードされた id リストに依存しない）。
 *
 * - exact: 候補の download_page_url と完全一致する source.url を持つカタログエントリがある
 * - site: hostname が一致するカタログエントリがある（同じ配布元から既に何か登録済み）
 * - none: どちらも無し
 */
// 候補データの site 表記 → SPDX の LicenseRef サフィックスに使う ASCII スラグ。
// audio-import レーンの既存登録分（LicenseRef-DOVA-SYNDROME-Free 等）と同じ命名規約を踏襲する。
const SITE_SLUGS = {
    'OtoLogic': 'OtoLogic',
    '効果音ラボ': 'SoundEffectLab',
    'Freesound': 'Freesound',
    'Pixabay': 'Pixabay-Content-License',
    'DOVA-SYNDROME': 'DOVA-SYNDROME',
    '甘茶の音楽工房': 'Amachamusic',
    'Kevin MacLeod (incompetech)': 'Incompetech',
    '魔王魂': 'MaouDamashii',
    'くらげ工匠': 'KurageKosho',
    "Springin' Sound Stock": 'SpringinSoundStock',
    'ポケットサウンド': 'PocketSound',
    'PeriTune': 'PeriTune',
};

export function spdxFor(site) {
    const slug = SITE_SLUGS[site] ?? site.replace(/[^A-Za-z0-9-]/g, '');
    return `LicenseRef-${slug}-Free`;
}

/**
 * candidates.json の 1 件（+ 実際にドロップフォルダから拾えたファイル名一覧）から、
 * assets ライブラリ（user scope 等の実体を持つ側）用の meta.json を組み立てる。
 * schema v0（packages/schemas/asset-meta.schema.json）準拠。`remote` は付けない
 * （実体を保持する側のため）。
 */
export function buildLibraryMeta(item, categoryLabelJa, fileNames, { registeredAt }) {
    const countNote = fileNames.length > 1 ? `（収録 ${fileNames.length} 点: ${fileNames.join(', ')}）` : '';
    return {
        id: item.id,
        category: 'audio',
        title: item.title_ja,
        description: `${item.site} 配布の音源。setup-audio-library のドロップフォルダ登録により取り込み${countNote}`,
        when_to_use: `${categoryLabelJa} 用途。詳細は catalog/audio/${item.id}/meta.json（取得元カタログエントリ）を参照`,
        tags: [item.category_id, item.type],
        knobs: [],
        ai_usage: `音源そのもの（波形）は改変しない。ピッチ・音量・トリム程度の加工は可。${item.license.attribution_required ? 'クレジット表記が必要（配布元の指定書式に従う）。' : 'クレジット表記は不要（任意）。'}AI学習データとしての二次利用は${item.license.ai_training_allowed ? '配布元の規約上は許容されるが、プロジェクト方針として個別確認すること' : 'しない'}。`,
        requires: [],
        provenance: {
            origin: `setup-audio-library ドロップフォルダ登録 / 候補 rank #${item.rank} (catalog/audio/candidates.json) / 取得元: ${item.download_page_url} / 登録日: ${registeredAt}`,
            generator: null,
        },
        author: item.site,
        license: {
            spdx: spdxFor(item.site),
            scope: item.license.redistribution === 'prohibited' || item.license.redistribution?.startsWith('prohibited') ? 'commercial-ok' : 'commercial-ok',
            attribution_required: Boolean(item.license.attribution_required),
            ai_training_allowed: Boolean(item.license.ai_training_allowed),
        },
        price: null,
        source: {
            url: item.download_page_url,
            acquisition: 'direct',
            license_at_source: item.license.note ?? 'candidates.json 参照',
            attribution_required: Boolean(item.license.attribution_required),
        },
    };
}

/**
 * catalog/audio/<id>/meta.json 用（remote: true、実体を持たない参照エントリ）。
 */
export function buildCatalogMeta(item, categoryLabelJa) {
    return {
        id: item.id,
        category: 'audio',
        title: item.title_ja,
        description: `${item.site} 配布の${categoryLabelJa}系音源。setup-audio-library 候補リスト rank #${item.rank}`,
        when_to_use: `${categoryLabelJa} 用途`,
        tags: [item.category_id, item.type],
        knobs: [],
        ai_usage: `取得後は音源をそのまま配置する用途を想定。音源そのもの（波形）は改変しない。${item.license.ai_training_allowed ? '' : 'AI学習データとしての二次利用はしない。'}`,
        requires: [],
        provenance: {
            origin: `AKARI Video 音源候補カタログ収録（setup-audio-library / candidates.json rank #${item.rank}）/ 生成日: ${new Date().toISOString().slice(0, 10)}`,
            generator: null,
        },
        author: item.site,
        license: {
            spdx: spdxFor(item.site),
            scope: 'commercial-ok',
            attribution_required: Boolean(item.license.attribution_required),
            ai_training_allowed: Boolean(item.license.ai_training_allowed),
        },
        price: null,
        remote: true,
        source: {
            url: item.download_page_url,
            acquisition: 'direct',
            license_at_source: item.license.note ?? 'candidates.json 参照',
            attribution_required: Boolean(item.license.attribution_required),
        },
    };
}

export function computeOwnership(flatCandidates, catalogEntries) {
    const ownership = new Map();

    for (const item of flatCandidates) {
        const candidateHost = hostnameOf(item.download_page_url);
        let status = 'none';
        const matchedIds = [];

        for (const { dirName, meta } of catalogEntries) {
            const sourceUrl = meta?.source?.url;
            if (typeof sourceUrl !== 'string') {
                continue;
            }
            if (sourceUrl === item.download_page_url) {
                status = 'exact';
                matchedIds.push(dirName);
                continue;
            }
            if (candidateHost && hostnameOf(sourceUrl) === candidateHost) {
                if (status !== 'exact') {
                    status = 'site';
                }
                matchedIds.push(dirName);
            }
        }

        ownership.set(item.id, { status, matchedIds });
    }

    return ownership;
}
