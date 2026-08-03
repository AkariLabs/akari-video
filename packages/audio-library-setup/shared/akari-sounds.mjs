// akari-sounds — 自社（first-party）音源ライブラリ AKARI Sounds の一括取得ロジック（純粋部）。
//
// 第三者配布元の候補（candidates.mjs）と違い、AKARI Sounds は自社が配布主体の
// GitHub Release なので**一括ダウンロードを許可する**（2026-08-03 オーナー裁定:
// 「初回セットアップで無料音源を一括ダウンロードできるようにする」。
// SKILL.md の一括取得禁止ルールは第三者サイト保護の規律であり、自社 Release には適用しない。
// 詳細は skills/setup-audio-library/first-party.md）。
//
// このモジュールはネットワーク・ファイルシステムに触れない純粋ロジックのみ
// （URL 構築・catalog.json → 登録プランのマッピング・meta.json 組み立て）。
// I/O は bin/fetch-akari-sounds.mjs 側。

export const AKARI_SOUNDS_REPO = 'AkariLabs/akari-sounds';
export const AKARI_SOUNDS_DEFAULT_TAG = 'v0';
export const AKARI_SOUNDS_SPDX = 'LicenseRef-AKARI-Sounds-Terms-v0';

const KIND_LABEL_JA = {
    bgm: 'BGM',
    sfx: '効果音',
    jingle: 'ジングル',
    loop: 'ループ',
};

const KIND_WHEN_TO_USE = {
    bgm: '解説・Vlog・作業風景などの敷き BGM。テンションや BPM はトラックのタグを参照',
    sfx: 'クリック・ポップ・whoosh・リザルト等のワンショット効果音',
    jingle: 'イントロ / アウトロ / 場面転換 / 達成などの短尺スティンガー',
    loop: 'ループ再生前提の敷き素材',
};

export function releasePageUrl(tag = AKARI_SOUNDS_DEFAULT_TAG) {
    return `https://github.com/${AKARI_SOUNDS_REPO}/releases/tag/${tag}`;
}

export function releaseAssetUrl(assetName, tag = AKARI_SOUNDS_DEFAULT_TAG) {
    return `https://github.com/${AKARI_SOUNDS_REPO}/releases/download/${tag}/${assetName}`;
}

export function rawFileUrl(filePath, tag = AKARI_SOUNDS_DEFAULT_TAG) {
    return `https://raw.githubusercontent.com/${AKARI_SOUNDS_REPO}/${tag}/${filePath}`;
}

/** variant ('mp3' | 'wav') に応じた Release zip アセット名の一覧 */
export function zipAssetNames(variant) {
    if (variant === 'mp3') {
        return ['akari-sounds-mp3.zip'];
    }
    if (variant === 'wav') {
        // WAV は容量の都合で 3 分割（akari-sounds Release v0 のレイアウト）
        return ['akari-sounds-wav-1.zip', 'akari-sounds-wav-2.zip', 'akari-sounds-wav-3.zip'];
    }
    throw new Error(`unknown variant: ${variant}（mp3 | wav）`);
}

/**
 * akari-sounds の catalog.json を kind ごとの「パック」登録プランへ変換する。
 * パック粒度（例: akari-sounds-bgm = BGM 全トラック 1 エントリ）は既存 catalog/audio の
 * 他ライブラリ（魔王魂カテゴリ単位等）と同じ粒度に合わせた設計。
 */
export function planFromCatalog(catalog, { variant = 'mp3' } = {}) {
    if (!catalog || !Array.isArray(catalog.tracks)) {
        throw new Error('akari-sounds catalog.json の形式が想定と違います（tracks 配列がない）');
    }
    const fileKey = variant === 'wav' ? 'file' : 'mp3';
    const byKind = new Map();
    for (const track of catalog.tracks) {
        const kind = track.kind ?? 'bgm';
        if (!byKind.has(kind)) {
            byKind.set(kind, { tracks: [], files: [] });
        }
        const bucket = byKind.get(kind);
        bucket.tracks.push(track);
        for (const take of track.files ?? []) {
            const name = take[fileKey];
            if (typeof name === 'string' && name) {
                bucket.files.push(name);
            }
        }
    }

    const packs = [...byKind.entries()].map(([kind, bucket]) => ({
        id: `akari-sounds-${kind}`,
        kind,
        labelJa: KIND_LABEL_JA[kind] ?? kind,
        trackCount: bucket.tracks.length,
        takeCount: bucket.files.length,
        files: bucket.files,
        tracks: bucket.tracks,
    }));
    packs.sort((a, b) => a.id.localeCompare(b.id));
    return {
        variant,
        library: catalog.library ?? 'AKARI Sounds',
        version: catalog.version ?? null,
        packs,
        totalFiles: packs.reduce((n, p) => n + p.files.length, 0),
    };
}

function sharedMetaFields(pack, { tag }) {
    return {
        category: 'audio',
        title: `AKARI Sounds ${pack.labelJa}（${tag}）`,
        description:
            `自社音源ライブラリ AKARI Sounds の${pack.labelJa}パック。` +
            `${pack.trackCount} トラック / ${pack.takeCount} テイク。全トラック AI 生成` +
            `（Suno 有料プラン）で、生成記録（日時・プロンプト・生成元 URL）は akari-sounds の ` +
            `catalog.json に公開されている`,
        when_to_use: KIND_WHEN_TO_USE[pack.kind] ?? `${pack.labelJa} 用途`,
        tags: ['akari-sounds', pack.kind, 'ai-generated', 'suno'],
        knobs: [],
        ai_usage:
            '利用条件（AKARI Sounds Terms v0）上、カット・ループ・ピッチ変更・ミックス等の編集加工は可。' +
            '単体再配布・音楽配信サービス登録・Content ID 登録は禁止。' +
            'AI 学習データとしての二次利用はしない（明示許可なしのため安全側）。',
        requires: [],
        author: 'AKARI Sounds',
        license: {
            spdx: AKARI_SOUNDS_SPDX,
            scope: 'commercial-ok',
            attribution_required: false,
            ai_training_allowed: false,
        },
        price: null,
        source: {
            url: releasePageUrl(tag),
            acquisition: 'direct',
            license_at_source:
                '商用可・クレジット不要。禁止: 単体再配布/販売・配信サービス登録・Content ID 登録。' +
                'AS-IS 無保証（TERMS.md）',
            attribution_required: false,
        },
    };
}

/** user スコープ（実体あり）の meta.json。schema v0 準拠・remote は付けない */
export function buildPackLibraryMeta(pack, { tag = AKARI_SOUNDS_DEFAULT_TAG, fetchedAt } = {}) {
    return {
        id: pack.id,
        ...sharedMetaFields(pack, { tag }),
        provenance: {
            origin:
                `akari-sounds Release ${tag} からの first-party 一括取得` +
                `（fetch-akari-sounds.mjs${fetchedAt ? ` / 取得日: ${fetchedAt}` : ''}）。` +
                '生成記録は同梱 .origin-catalog.json（akari-sounds catalog.json の取得時点スナップショット）',
            generator: 'suno',
        },
    };
}

/** catalog/audio/<id>/meta.json 用（remote: true・実体を持たない参照エントリ） */
export function buildPackCatalogMeta(pack, { tag = AKARI_SOUNDS_DEFAULT_TAG } = {}) {
    return {
        id: pack.id,
        ...sharedMetaFields(pack, { tag }),
        provenance: {
            origin:
                `akari-sounds Release ${tag} の first-party 参照エントリ（一括取得は ` +
                'packages/audio-library-setup/bin/fetch-akari-sounds.mjs）',
            generator: 'suno',
        },
        remote: true,
    };
}
