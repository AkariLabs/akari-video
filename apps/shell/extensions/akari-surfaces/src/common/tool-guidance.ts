import { t } from '@akari-video/i18n';
import type { AkariToolCheckResult, AkariToolId } from './akari-new-project-protocol';

type ToolAvailability = Pick<AkariToolCheckResult, 'available' | 'unsupported' | 'needs'>
    & Partial<Pick<AkariToolCheckResult, 'id'>>;

/** 道具行の状態札。通常行は初回セットアップの既存文言を保つ。 */
export function describeToolAvailabilityLabel(tool: ToolAvailability): string {
    if (tool.unsupported) {
        return t('surfaces.tools.cannotOs.label');
    }
    if (tool.needs?.length) {
        return t('surfaces.tools.preparationRequired.message', { requirements: tool.needs.join(t('surfaces.toolGuidance.list.separator')) });
    }
    if (tool.id && TOOL_UI[tool.id].osProvided) {
        return tool.available ? t('surfaces.tools.describeToolAvailabilityLabel.label') : t('surfaces.tools.preparationRequired.label');
    }
    return tool.available ? t('surfaces.tools.installed.status') : t('surfaces.tools.notInstalled.status');
}

/** DOM に依存しない行描画の判定。unsupported は available より優先する。 */
export function deriveToolRowState(tool: ToolAvailability): { label: string; showCheckbox: boolean } {
    return { label: describeToolAvailabilityLabel(tool), showCheckbox: !tool.unsupported && !tool.available };
}

/** 利用条件の案内は準備できたら隠し、利用時の注意書きは残す。 */
export function shouldShowToolNote(tool: Pick<AkariToolCheckResult, 'id' | 'available'>): boolean {
    const info = TOOL_UI[tool.id];
    return Boolean(info.note) && !(info.hideNoteWhenAvailable && tool.available);
}

export const SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE =
    t('surfaces.tools.speechanalyzerRequiresMacosLaterCommandLineTools.description');

export interface ToolUiInfo {
    name: string;
    badge: string;
    purpose: string;
    /** ダウンロード容量の目安（表示用）。「約 300MB」形式。実装時に公式配布物の実サイズで確定してよい。 */
    sizeLabel: string;
    note?: string;
    /** OS 付属の機能であり、自動導入せず利用条件を案内する。 */
    osProvided?: true;
    /** 利用可能になったら準備用の案内を非表示にする。 */
    hideNoteWhenAvailable?: true;
}

/** whisper 行のモデルサブ行の表示用サイズ（`tool-install.ts` の `WHISPER_MODEL_FILENAME` 実測サイズ）。 */
export const WHISPER_MODEL_SIZE_LABEL = t('surfaces.tools.whisperModelDownloadSize.label');

/**
 * 検知結果と分離した、UI に表示する案内の正本。
 * 自動導入は `src/node/tool-install.ts` のインストールエンジンが担当する。
 * 手動導入の案内もここに集約し、インストール結果と共有する。
 */
export const TOOL_UI: Record<AkariToolId, ToolUiInfo> = {
    ffmpeg: {
        name: 'FFmpeg', badge: t('surfaces.tools.basicAlmostRequired.label'), purpose: t('surfaces.tools.convertingPreviewingExportingVideosAudio.message'),
        sizeLabel: t('surfaces.tools.ffmpegDownloadSize.label')
    },
    whisper: {
        name: 'Whisper（whisper.cpp）', badge: t('surfaces.tools.basic.label'), purpose: t('surfaces.tools.transcribingAssetModelRequiredSeparatelyExecutableFile.message'),
        sizeLabel: t('surfaces.tools.whisperDownloadSize.label')
    },
    'yt-dlp': {
        name: 'yt-dlp', badge: t('surfaces.tools.advance.label'), purpose: t('surfaces.tools.obtainApprovedVideoAssets.message'),
        sizeLabel: t('surfaces.tools.ytDlpDownloadSize.label')
    },
    voicevox: {
        name: 'VOICEVOX', badge: t('surfaces.tools.advance.label'), purpose: t('surfaces.tools.generateLocalJapaneseNarration.message'),
        sizeLabel: t('surfaces.tools.voicevoxDownloadSize.label'),
        note: t('surfaces.tools.mustProvideCreditAccordingTermsConditionsAudio.message')
    },
    voice: {
        name: t('surfaces.tools.voice.name.label'), badge: t('surfaces.tools.voice.badge.label'),
        purpose: t('surfaces.tools.voice.purpose.message'),
        sizeLabel: t('surfaces.tools.voice.size.label'),
        note: t('surfaces.tools.voice.license.note')
    },
    blender: {
        name: 'Blender CLI', badge: t('surfaces.tools.advance.label'), purpose: t('surfaces.tools.blenderPreRenderThreeDimensionalAssets.description'),
        sizeLabel: t('surfaces.tools.blenderDownloadSize.label')
    },
    'speech-analyzer': {
        osProvided: true,
        hideNoteWhenAvailable: true,
        name: 'SpeechAnalyzer', badge: t('surfaces.tools.recommended.label'), purpose: t('surfaces.tools.transcribeQuicklyComputer.message'),
        sizeLabel: t('surfaces.tools.includedMacos.label'), note: SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE
    },
    'xcode-clt': {
        hideNoteWhenAvailable: true,
        name: 'macOS: Command Line Tools', badge: t('surfaces.tools.recommended.label'), purpose: t('surfaces.tools.projectHistoryDifferencesSnapshotsHighSpeedTranscription.message'),
        sizeLabel: t('surfaces.tools.commandLineToolsDownloadSize.label'),
        note: t('surfaces.tools.makeVideosWithoutAutomaticallyEnabledDeploymentHistory.message')
    }
};
