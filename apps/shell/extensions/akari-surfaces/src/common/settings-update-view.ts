import { t } from '@akari-video/i18n';
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
    const checked = t('surfaces.settings.lastChecked.message', { lastChecked: lastChecked });
    if (state.downloaded && state.downloadedVersion) {
        return {
            label: t('surfaces.settings.vReady.label', { downloadedVersion: state.downloadedVersion }),
            detail: t('surfaces.settings.currentlyV.label', { updateStatus: formatDownloadedBannerText(state), currentVersion: currentVersion, checkedAt: checked }),
            button: { kind: 'restart', label: t('surfaces.settings.rebootUpdate.label'), disabled: false, primary: true },
            browserFallback: false
        };
    }
    if (state.downloading && state.downloadingVersion) {
        return {
            label: t('surfaces.settings.downloadingV.label', { downloadingVersion: state.downloadingVersion }),
            detail: t('surfaces.settings.currentlyV.label', { updateStatus: formatDownloadingBannerText(state), currentVersion: currentVersion, checkedAt: checked }),
            button: { kind: 'check', label: t('surfaces.settings.downloading.label'), disabled: true, primary: false },
            browserFallback: false
        };
    }
    if (state.failed) {
        return {
            label: state.failureReason ?? t('surfaces.settings.checkUpdatesTryAgainLater.status'),
            detail: state.fallbackReason ? `${formatUpdaterFallbackText(state)} · ${checked}` : checked,
            button: { kind: 'check', label: t('surfaces.settings.checkAgain.label'), disabled: false, primary: false },
            browserFallback: !!downloadUrl
        };
    }
    if (state.checkRequestedByUser || lastEventKind === 'checking-for-update') {
        return {
            label: t('surfaces.settings.confirming.label'), detail: checked,
            button: { kind: 'check', label: t('surfaces.settings.checkUpdates.label'), disabled: true, primary: false },
            browserFallback: false
        };
    }
    return {
        label: lastEventKind === 'update-not-available' ? t('surfaces.settings.latestV.message', { currentVersion: currentVersion }) : t('surfaces.settings.checkUpdatesAvailable.status'),
        detail: checked,
        button: { kind: 'check', label: t('surfaces.settings.checkUpdates.label'), disabled: false, primary: false },
        browserFallback: false
    };
}
