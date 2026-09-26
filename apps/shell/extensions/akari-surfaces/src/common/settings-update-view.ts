import {
    formatDownloadedBannerText, formatDownloadingBannerText, formatUpdaterFallbackText,
    ShellUpdaterEventKind, ShellUpdaterUiState
} from './shell-update-applier';

export interface SettingsUpdateView {
    label: string;
    detail: string;
    button: { kind: 'check' | 'restart'; label: string; disabled: boolean; primary: boolean };
    browserFallback: boolean;
}

/** 設定画面の更新行。イベントの解釈は shell-update-applier に委ね、ここでは表示だけを決める。 */
export function resolveSettingsUpdateView(input: {
    state: ShellUpdaterUiState;
    lastEventKind?: ShellUpdaterEventKind;
    currentVersion: string;
    lastChecked: string;
    downloadUrl?: string;
}): SettingsUpdateView {
    const { state, lastEventKind, currentVersion, lastChecked, downloadUrl } = input;
    const checked = `最後に確かめた: ${lastChecked}`;
    if (state.downloaded && state.downloadedVersion) {
        return {
            label: `v${state.downloadedVersion} の準備ができました`,
            detail: `${formatDownloadedBannerText(state)} 現在 v${currentVersion} · ${checked}`,
            button: { kind: 'restart', label: '再起動して更新', disabled: false, primary: true },
            browserFallback: false
        };
    }
    if (state.downloading && state.downloadingVersion) {
        return {
            label: `v${state.downloadingVersion} をダウンロードしています`,
            detail: `${formatDownloadingBannerText(state)} 現在 v${currentVersion} · ${checked}`,
            button: { kind: 'check', label: 'ダウンロード中', disabled: true, primary: false },
            browserFallback: false
        };
    }
    if (state.failed) {
        return {
            label: `更新を確認できませんでした: ${state.failureReason ?? '原因を確認できませんでした'}`,
            detail: state.fallbackReason ? `${formatUpdaterFallbackText(state)} · ${checked}` : checked,
            button: { kind: 'check', label: 'もう一度確かめる', disabled: false, primary: false },
            browserFallback: !!downloadUrl
        };
    }
    if (state.checkRequestedByUser || lastEventKind === 'checking-for-update') {
        return {
            label: '確認しています…', detail: checked,
            button: { kind: 'check', label: 'アップデートを確認', disabled: true, primary: false },
            browserFallback: false
        };
    }
    return {
        label: lastEventKind === 'update-not-available' ? `最新です（v${currentVersion}）` : 'アップデートを確認できます',
        detail: checked,
        button: { kind: 'check', label: 'アップデートを確認', disabled: false, primary: false },
        browserFallback: false
    };
}
