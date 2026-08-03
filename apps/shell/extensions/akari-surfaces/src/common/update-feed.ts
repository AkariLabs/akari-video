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

export interface UpdateFeedAsset {
    url?: string;
    sha256?: string;
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
    dismissed?: Record<string, string>;
}

export interface UpdateStatus {
    available: boolean;
    dismissed?: boolean;
    latestVersion?: string;
    currentVersion?: string;
    channel?: string;
    notesUrl?: string;
    /** F7-v1（task 2026-08-03-home-v5-terms）: 「更新する」ボタンの遷移先。resolveUpdateDownloadUrl 参照。 */
    downloadUrl?: string;
}

/** "major.minor.patch" の先頭 3 要素だけを数値比較する（prerelease 考慮不要 — 契約 D4: stable のみ）。 */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersionTriplet(a);
    const pb = parseVersionTriplet(b);
    if (!pa || !pb) {
        return 0;
    }
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] < pb[i] ? -1 : 1;
        }
    }
    return 0;
}

function parseVersionTriplet(value: string): [number, number, number] | null {
    const match = typeof value === 'string' ? value.trim().match(/^(\d+)\.(\d+)\.(\d+)/) : null;
    if (!match) {
        return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
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
export function resolveUpdateDownloadUrl(feed: UpdateFeed | null | undefined, platform: ShellPlatformKey | undefined): string | undefined {
    const asset = platform ? feed?.components?.shell?.[platform] : undefined;
    return asset?.url || feed?.notes_url || undefined;
}

/** キャッシュ + 現在版から、ホームバナーを出すかどうかを判定する（同期・純粋関数）。 */
export function evaluateUpdateStatus(currentVersion: string, cache: UpdateCache | null, platform?: ShellPlatformKey): UpdateStatus {
    const feed = cache?.feed;
    if (!isValidFeedShape(feed)) {
        return { available: false };
    }
    const latest = feed.product as string;
    if (compareVersions(latest, currentVersion) <= 0) {
        return { available: false };
    }
    const dismissedAt = cache?.dismissed?.[latest];
    if (dismissedAt) {
        return { available: false, dismissed: true, latestVersion: latest };
    }
    return {
        available: true,
        latestVersion: latest,
        currentVersion,
        channel: typeof feed.channel === 'string' ? feed.channel : undefined,
        notesUrl: typeof feed.notes_url === 'string' ? feed.notes_url : undefined,
        downloadUrl: resolveUpdateDownloadUrl(feed, platform)
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
export function withFetchedFeed(cache: UpdateCache | null, feed: UpdateFeed, nowIso: string): UpdateCache {
    return {
        schema: 1,
        fetched_at: nowIso,
        feed,
        dismissed: cache?.dismissed ?? {}
    };
}
