import type { AkariToolCheckResult, AkariToolId, AkariToolInstallResult } from './akari-new-project-protocol';

/**
 * 初回セットアップ v2（裁定 A）の道具ステップから UI を分離した純ロジック。
 * ダイアログ（browser 側）は状態機械の判定・進捗文字列・結果のマッピングを
 * ここへ寄せてテストする（task.md 手順 7）。
 */

export interface ToolSelectionSnapshot {
    selectedIds: ReadonlySet<AkariToolId>;
    unavailableIds: ReadonlySet<AkariToolId>;
}

export const TOOL_INSTALL_NOTICE = 'Windows では winget、Mac では Homebrew で導入します。導入すると各ソフトの利用規約に同意したことになります。';

export const TOOL_PROVIDERS: Record<AkariToolId, { provider: string; termsUrl: string }> = {
    ffmpeg: { provider: 'FFmpeg 開発チーム', termsUrl: 'https://ffmpeg.org/legal.html' },
    whisper: { provider: 'ggml 開発チーム', termsUrl: 'https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE' },
    'yt-dlp': { provider: 'yt-dlp 開発チーム', termsUrl: 'https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE' },
    voicevox: { provider: 'VOICEVOX', termsUrl: 'https://voicevox.hiroshiba.jp/term/' },
    blender: { provider: 'Blender Foundation', termsUrl: 'https://www.blender.org/about/license/' },
    'xcode-clt': { provider: 'Apple', termsUrl: 'https://www.apple.com/legal/sla/' },
    'speech-analyzer': { provider: 'Apple', termsUrl: 'https://www.apple.com/legal/sla/' }
};

/**
 * 未導入の道具に対する選択を導出する。
 * 直前の結果でも未導入だった道具は、ユーザーが外したチェックを再チェック後も尊重する。
 * 初回と新たに未導入と分かった道具は未選択にする。
 */
export function deriveToolSelection(
    tools: ReadonlyArray<Pick<AkariToolCheckResult, 'id' | 'available' | 'unsupported'>>,
    previous?: ToolSelectionSnapshot
): Set<AkariToolId> {
    const next = new Set<AkariToolId>();
    for (const tool of tools) {
        if (tool.available || tool.unsupported) {
            continue;
        }
        const wasUnavailableBefore = previous?.unavailableIds.has(tool.id) ?? false;
        const shouldCheck = wasUnavailableBefore && previous!.selectedIds.has(tool.id);
        if (shouldCheck) {
            next.add(tool.id);
        }
    }
    return next;
}

/** 保存済み・手動の選択も、現在インストール対象にできる道具だけに絞る。 */
export function filterInstallableSelection(
    tools: ReadonlyArray<Pick<AkariToolCheckResult, 'id' | 'available' | 'unsupported'>>,
    selectedIds: ReadonlySet<AkariToolId>
): Set<AkariToolId> {
    return new Set(tools.filter(tool => !tool.available && !tool.unsupported && selectedIds.has(tool.id)).map(tool => tool.id));
}

/** 「インストール中: FFmpeg (1/3)…」形式の進捗表示文字列。 */
export function formatInstallProgressLabel(toolName: string, index: number, total: number): string {
    return `インストール中: ${toolName} (${index}/${total})…`;
}

/** 導入結果をそのまま表示できる 1 行へ寄せる。 */
export function describeToolInstallOutcome(result: AkariToolInstallResult, toolName: string): string {
    if (result.message) {
        return result.message;
    }
    switch (result.outcome) {
        case 'installed':
            return `${toolName} を導入しました。`;
        case 'external-installer-opened':
            return `${toolName} のインストーラーを開きました。完了したら再チェックしてください。`;
        case 'skipped':
            return `${toolName} は手動で入れる必要があります。`;
        case 'failed':
            return `${toolName} の導入に失敗しました。もう一度お試しください。`;
    }
}

/** 作成先パスをホーム配下のとき `~/` 短縮表示にする（作業場ステップ v2・裁定 B2）。 */
export function shortenHomePath(path: string, homeDir: string | undefined): string {
    if (!homeDir) {
        return path;
    }
    const normalizedHome = homeDir.replace(/[\\/]+$/, '');
    const normalizedPath = path;
    if (normalizedPath === normalizedHome) {
        return '~';
    }
    if (normalizedPath.startsWith(`${normalizedHome}/`)) {
        return `~${normalizedPath.slice(normalizedHome.length)}`;
    }
    if (normalizedPath.startsWith(`${normalizedHome}\\`)) {
        return `~${normalizedPath.slice(normalizedHome.length)}`;
    }
    return path;
}
