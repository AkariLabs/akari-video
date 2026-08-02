/**
 * 「更新されました」ポップアップ（F2・task 2026-08-03-shell-quickwins-feedback）の評価ロジック。
 *
 * `update-feed.ts`（U2 v0・D5 裁定）とは別の仕組み: あちらは「配布サーバ上に新版が
 * 公開されているか」（リモートフィードとの比較・ホームバナー表示）を扱うのに対し、
 * こちらは「今回の起動は前回起動と版が変わっているか」（ローカルの前回起動記録との
 * 比較だけで完結・ネットワーク不要）を判定する。前回起動版は
 * `<AKARI_HOME>/shell-last-version.json` に `{ lastVersion, updatedAt }` で
 * 永続化する（task.md 指定）。
 */

export interface ShellLastVersionRecord {
    lastVersion?: string;
    updatedAt?: string;
}

export interface ShellVersionNoticeStatus {
    shouldNotify: boolean;
    previousVersion?: string;
}

/** JSON.parse の結果を前回起動記録として扱えるかだけを見る純粋関数（I/O はしない）。壊れていれば null。 */
export function parseShellLastVersion(raw: string): ShellLastVersionRecord | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as ShellLastVersionRecord : null;
    } catch {
        return null;
    }
}

/**
 * 前回起動記録 + 現在版から、「更新されました」ポップアップを出すかどうかを判定する
 * （同期・純粋関数）。記録が無い（初回起動・壊れた記録）ときは出さず記録だけ書く
 * （task.md「初回起動はポップアップを出さず記録だけ書く」）。前回と同じ版のときも出さない。
 */
export function evaluateVersionNotice(currentVersion: string, record: ShellLastVersionRecord | null): ShellVersionNoticeStatus {
    const previousVersion = record?.lastVersion;
    if (typeof previousVersion !== 'string' || previousVersion.length === 0) {
        return { shouldNotify: false };
    }
    if (previousVersion === currentVersion) {
        return { shouldNotify: false };
    }
    return { shouldNotify: true, previousVersion };
}

/** ポップアップ本文（task.md 指示どおりの文言: 「AKARI Video を vX.Y.Z に更新しました」）。 */
export function formatVersionNoticeText(currentVersion: string): string {
    return `AKARI Video を v${currentVersion} に更新しました`;
}

/** 今回の起動版を記録する新しいレコードを組み立てる純粋関数（書き込みは呼び出し側の責務）。 */
export function withRecordedVersion(version: string, nowIso: string): ShellLastVersionRecord {
    return { lastVersion: version, updatedAt: nowIso };
}

/**
 * 「変更点を見る」の遷移先。GitHub リリースタグの規約
 * （`update-feed.ts` が扱うフィードの `notes_url` 実例と同じ
 * `https://github.com/AkariLabs/akari-video/releases/tag/v<version>` 形）を流用する。
 */
export function buildReleaseNotesUrl(version: string): string {
    return `https://github.com/AkariLabs/akari-video/releases/tag/v${version}`;
}
