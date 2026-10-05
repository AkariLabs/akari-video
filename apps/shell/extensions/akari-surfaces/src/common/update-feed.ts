/**
 * 更新フィード（`~/.akari/update-check.json`）の評価ロジック。
 *
 * update-and-versioning 契約（内部リポ）§3 §4 に従う。CLI 側
 * （公開リポ `packages/akari-launcher/src/update-check.mjs`）と
 * 同一のキャッシュファイル・同一の判定規則（新版あり/dismissed 済み/壊れたフィード
 * は沈黙）を共有するが、コードは意図的に複製している —
 * CLI は Node 専用 API（`node:fs` / `node:child_process`）で直接ファイルを触るのに対し、
 * このフロントエンド（ブラウザ/Electron レンダラー）は `FileService` 経由でしか
 * OS ファイルに触れられず、かつパッケージ境界（`apps/shell/extensions/akari-surfaces/`
 * の外は編集禁止）のため launcher パッケージを直接 import することもできない。
 * 変更する際は両ファイルの整合を手動で確認すること。
 */

export const DEFAULT_UPDATE_FEED_URL = 'https://github.com/AkariLabs/akari-video/releases/download/updates/latest.json';
export const PRERELEASE_UPDATE_FEED_URL = 'https://github.com/AkariLabs/akari-video/releases/download/updates/prerelease.json';

/** 明示 URL は完全上書き。ただし評価側の安定版ガードは常に有効。 */
export function resolveUpdateFeedUrl(channel: 'stable' | 'prerelease', override?: string): string {
    return override || (channel === 'prerelease' ? PRERELEASE_UPDATE_FEED_URL : DEFAULT_UPDATE_FEED_URL);
}

export interface UpdateFeedAsset {
    url?: string;
    sha256?: string;
    size?: number;
    size_bytes?: number;
}

export interface UpdateFeedCliComponent {
    version?: string;
    npm?: string;
    tarball?: UpdateFeedAsset;
}

/**
 * shell コンポーネントの配布物（F7-v1・task 2026-08-03-home-v5-terms）。
 * 実スキーマは非公開の release ジェネレータ `scripts/release/gen-latest-json.mjs`
 * （このパッケージの編集境界外）が正本 — `mac` / `win`（インストーラ） /
 * `win_zip`（ポータブル zip）の 3 キー。ここでは「更新する」ボタンが読む範囲だけを
 * 型として揃える（複製ではなく形状の追随）。
 */
export interface UpdateFeedShellComponent {
    version?: string;
    mac?: UpdateFeedAsset;
    win?: UpdateFeedAsset;
    win_zip?: UpdateFeedAsset;
}

export interface UpdateFeed {
    schema?: number;
    product?: string;
    channel?: string;
    released?: string;
    notes_url?: string;
    summary?: string;
    size?: number | string;
    size_bytes?: number;
    size_mb?: number;
    components?: {
        cli?: UpdateFeedCliComponent;
        shell?: UpdateFeedShellComponent;
        plugin?: { version?: string };
    };
}

/** 「更新する」ボタンが対応する自プラットフォームのキー（F7-v1）。Linux 等の未対応 OS は undefined。 */
export type ShellPlatformKey = 'mac' | 'win';

export interface UpdateCache {
    schema?: number;
    fetched_at?: string | null;
    feed?: UpdateFeed | null;
    feed_url?: string;
    dismissed?: Record<string, string>;
}

export interface UpdateStatus {
    available: boolean;
    dismissed?: boolean;
    latestVersion?: string;
    currentVersion?: string;
    channel?: string;
    notesUrl?: string;
    summary?: string;
    sizeLabel?: string;
    /** F7-v1（task 2026-08-03-home-v5-terms）: 「更新する」ボタンの遷移先。resolveUpdateDownloadUrl 参照。 */
    downloadUrl?: string;
}

/** semver の先行版を比較する。CLI は外部依存ゼロなので同じ規則を version.mjs に持つ。 */
export function compareVersions(a: string, b: string): number {
    const parse = (value: string): { core: number[]; pre: string[] | null } | null => {
        const match = typeof value === 'string' ? value.trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/) : null;
        if (!match) { return null; }
        const pre = match[4]?.split('.') ?? null;
        if (pre?.some(id => /^0\d+$/.test(id))) { return null; }
        return { core: match.slice(1, 4).map(Number), pre };
    };
    const left = parse(a), right = parse(b);
    if (!left || !right) { return 0; }
    for (let i = 0; i < 3; i++) {
        if (left.core[i] !== right.core[i]) { return Math.sign(left.core[i] - right.core[i]); }
    }
    if (!left.pre || !right.pre) { return left.pre === right.pre ? 0 : left.pre ? -1 : 1; }
    for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
        const x = left.pre[i], y = right.pre[i];
        if (x === y) { continue; }
        const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
        if (xn && yn) { return BigInt(x) > BigInt(y) ? 1 : -1; }
        if (xn !== yn) { return xn ? -1 : 1; }
        return x < y ? -1 : 1;
    }
    return Math.sign(left.pre.length - right.pre.length);
}

/** `feed` が最低限の形をしているか（壊れたフィードを弾く）。 */
export function isValidFeedShape(feed: unknown): feed is UpdateFeed {
    if (!feed || typeof feed !== 'object') {
        return false;
    }
    const candidate = feed as UpdateFeed;
    return typeof candidate.schema === 'number' && typeof candidate.product === 'string';
}

/** JSON.parse の結果をキャッシュとして扱えるかだけを見る純粋関数（I/O はしない）。壊れていれば null。 */
export function parseUpdateCache(raw: string): UpdateCache | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as UpdateCache : null;
    } catch {
        return null;
    }
}

/**
 * 「更新する」ボタン（F7-v1）の遷移先を決める純粋関数。自プラットフォームの配布物 URL
 * （`components.shell.mac.url` 等）を優先し、無ければ `notes_url` へフォールバックする
 * （task.md 指示どおり）。`platform` が undefined（未対応 OS）のときも `notes_url` へ倒す。
 */
export function resolveUpdateDownloadUrl(feed: UpdateFeed | null | undefined, platform: ShellPlatformKey | undefined,
    channel: 'stable' | 'prerelease' = 'stable'): string | undefined {
    // 設定画面の旧呼び出し元も、設定を読めない間はベータのブラウザ URL を出さない。
    if (channel === 'stable' && feed?.product?.includes('-')) { return undefined; }
    const asset = platform ? feed?.components?.shell?.[platform] : undefined;
    return asset?.url || feed?.notes_url || undefined;
}

/** フィードに任意で含まれる配布物サイズを、通知の短い MB 表記へ揃える。 */
export function resolveUpdateSizeLabel(feed: UpdateFeed | null | undefined, platform: ShellPlatformKey | undefined): string | undefined {
    if (typeof feed?.size_mb === 'number' && Number.isFinite(feed.size_mb) && feed.size_mb > 0) {
        return `${Math.round(feed.size_mb)} MB`;
    }
    const asset = platform ? feed?.components?.shell?.[platform] : undefined;
    const raw = feed?.size_bytes ?? asset?.size_bytes ?? asset?.size ?? feed?.size;
    if (typeof raw === 'string') { return raw.trim() || undefined; }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) { return undefined; }
    return `${Math.round(raw >= 10_000 ? raw / 1_000_000 : raw)} MB`;
}

/** キャッシュ + 現在版から、ホームバナーを出すかどうかを判定する（同期・純粋関数）。 */
export function evaluateUpdateStatus(currentVersion: string, cache: UpdateCache | null, platform?: ShellPlatformKey,
    channel: 'stable' | 'prerelease' = 'stable', feedUrl?: string): UpdateStatus {
    const feed = cache?.feed;
    if (!isValidFeedShape(feed) || (channel === 'stable' && feed.product?.includes('-'))
        || (cache?.feed_url && feedUrl && cache.feed_url !== feedUrl)) {
        return { available: false };
    }
    const latest = feed.product as string;
    if (compareVersions(latest, currentVersion) <= 0) {
        return { available: false };
    }
    const dismissedAt = cache?.dismissed?.[latest];
    const details = {
        notesUrl: typeof feed.notes_url === 'string' ? feed.notes_url : undefined,
        summary: typeof feed.summary === 'string' ? feed.summary.trim() || undefined : undefined,
        sizeLabel: resolveUpdateSizeLabel(feed, platform)
    };
    if (dismissedAt) {
        return { available: false, dismissed: true, latestVersion: latest, ...details };
    }
    return {
        available: true,
        latestVersion: latest,
        currentVersion,
        channel: typeof feed.channel === 'string' ? feed.channel : undefined,
        ...details,
        downloadUrl: resolveUpdateDownloadUrl(feed, platform, channel)
    };
}

/** channel が prerelease のときだけ付ける版名の注記（CLI 側 `formatUpdateNotice` と同じ規則）。 */
function channelSuffix(channel: string | undefined): string {
    return channel === 'prerelease' ? '（プレリリース）' : '';
}

/** ホームバナー本文。「AKARI Video v0.2.0（プレリリース）が利用できます」の形（task.md 指示）。 */
export function formatHomeBannerText(status: UpdateStatus): string {
    if (!status.available || !status.latestVersion) {
        return '';
    }
    return `AKARI Video v${status.latestVersion}${channelSuffix(status.channel)}が利用できます`;
}

/** 「今回はスキップ」で dismissed に記録した新しいキャッシュを組み立てる純粋関数（書き込みは呼び出し側の責務）。 */
export function withDismissedVersion(cache: UpdateCache | null, version: string, nowIso: string): UpdateCache {
    const base: UpdateCache = cache ?? { schema: 1, fetched_at: null, feed: null, dismissed: {} };
    return {
        ...base,
        dismissed: { ...(base.dismissed ?? {}), [version]: nowIso }
    };
}

/** バックグラウンド fetch が成功したときの新しいキャッシュを組み立てる純粋関数（dismissed は温存）。 */
export function withFetchedFeed(cache: UpdateCache | null, feed: UpdateFeed, nowIso: string, feedUrl?: string): UpdateCache {
    return {
        schema: 1,
        fetched_at: nowIso,
        feed,
        feed_url: feedUrl,
        dismissed: cache?.dismissed ?? {}
    };
}
