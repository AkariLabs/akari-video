/**
 * インストール進捗バー（裁定 E1）の純ロジック。node 側（`tool-install.ts` が spawn の
 * stdout/stderr 断片やダウンロードのバイト数を渡す）と browser 側（ダイアログの表示）の
 * 両方から使う共通関数だけを置く。実プロセス・実ネットワークには一切触れない。
 */

/** バイト数を「12MB」のように読みやすい単位へ整形する。1MB 未満は小数第1位まで。 */
export function formatBytes(bytes: number): string {
    const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const mb = safeBytes / (1024 * 1024);
    if (mb < 1) {
        return `${Math.round(mb * 10) / 10}MB`;
    }
    return `${Math.round(mb)}MB`;
}

/** ダウンロード行内バーの表記。totalBytes 不明のときは既知バイト数のみ返す（不定形バー用）。 */
export function formatDownloadProgressLabel(downloadedBytes: number, totalBytes?: number): string {
    if (totalBytes && totalBytes > 0) {
        return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
    }
    return formatBytes(downloadedBytes);
}

/** determinate バーの幅%（0〜100）。totalBytes 不明なら undefined（= indeterminate 表示）。 */
export function computeDownloadPercent(downloadedBytes: number, totalBytes?: number): number | undefined {
    if (!totalBytes || totalBytes <= 0) {
        return undefined;
    }
    const ratio = downloadedBytes / totalBytes;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/**
 * brew / winget の stdout・stderr 断片の末尾を、そのまま表示できる平易な日本語フェーズ
 * 1 行へ変換する（純関数・実プロセス非依存）。「仕上げ」系のキーワードを最優先で見る
 * ことで、"Successfully installed" のような文言が「展開しています」に埋もれないようにする。
 */
export function summarizeCommandInstallPhase(outputTail: string): string {
    const text = outputTail.trim();
    if (!text) {
        return '準備しています…';
    }
    if (/summary|already installed|up.?to.?date|successfully|success/i.test(text)) {
        return '仕上げています…';
    }
    if (/fetch|download|取得|ダウンロード/i.test(text)) {
        return 'パッケージを取得しています…';
    }
    if (/pour|install|extract|展開|インストール/i.test(text)) {
        return '展開しています…';
    }
    return '処理しています…';
}
