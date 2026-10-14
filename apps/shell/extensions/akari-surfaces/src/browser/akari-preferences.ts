import { t } from '@akari-video/i18n';
import { PreferenceContribution, PreferenceSchema, PreferenceScope } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

import { TRANSCRIBE_BACKENDS } from 'akari-shell-strip/lib/common/akari-connections-protocol';
import { AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE } from 'akari-shell-strip/lib/common/rail-ids';

export const AKARI_TRANSCRIBE_BACKEND = 'akari.transcribe.backend';
export const AKARI_TRANSCRIBE_COMPARE_SET = 'akari.transcribe.compareSet';
export const AKARI_TRANSCRIBE_AUTO_CUTS = 'akari.transcribe.autoCuts';
export const AKARI_NARRATION_ENGINE = 'akari.narration.engine';
export const AKARI_NARRATION_VOICE = 'akari.narration.voice';
export const AKARI_NARRATION_IRODORI_URL = 'akari.narration.irodoriUrl';

export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_PREVIEW_SCRUB_AUDIO = 'akari.preview.scrubAudio';
export const AKARI_TIMELINE_VISUAL_THUMBNAILS = 'akari.timeline.visualThumbnails';
export const AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY = 'akari.timeline.trackRippleDisplay';
// 読む側の文字列ミラー。スキーマは akari-project/src/browser/akari-project-frontend-module.ts が所有する。
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_VIBE_PREVIEW_ENABLED = 'akari.vibePreview.enabled';
// パートナー PTY（Claude Code 等）の応答完了 OS 通知（読む側: akari-partner の
// PartnerTurnNotifier — スキーマはここが所有し読む側は文字列ミラー）。
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';

const AKARI_PREFERENCE_SCHEMA: PreferenceSchema = {
    properties: {
        [AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE]: {
            type: 'boolean', default: false, scope: PreferenceScope.User,
            description: t('surfaces.settings.skipConfirmationOpeningProjectScreen.description')
        },
        [AKARI_VIBE_PREVIEW_ENABLED]: {
            type: 'boolean', default: false, scope: PreferenceScope.User,
            description: t('surfaces.settings.displayScreenEntranceAkariVibeDevelopmentReflected.description')
        },
        [AKARI_NARRATION_ENGINE]: { type: 'string', default: 'voicevox', description: t('surfaces.settings.defaultNarrationEngine.description') },
        [AKARI_NARRATION_VOICE]: { type: 'object', default: {}, description: t('surfaces.settings.narrationVoiceEngine.description') },
        [AKARI_NARRATION_IRODORI_URL]: { type: 'string', default: 'http://127.0.0.1:8088', description: t('surfaces.settings.ayaServerConnectionUrl.description') },
        // Old mode values in user settings are ignored by Theia after their schema entry is removed.
        [AKARI_TRANSCRIBE_BACKEND]: {
            type: 'string', enum: ['auto', ...TRANSCRIBE_BACKENDS], default: 'auto',
            description: t('surfaces.settings.defaultEngineTranscriptionLocalPrioritizedAuto.description')
        },
        [AKARI_TRANSCRIBE_COMPARE_SET]: {
            type: 'array', items: { type: 'string', enum: [...TRANSCRIBE_BACKENDS] }, default: [], uniqueItems: true,
            description: t('surfaces.settings.engineSetComparingTranscriptionsEmptyCompare.description')
        },
        [AKARI_TRANSCRIBE_AUTO_CUTS]: {
            type: 'boolean', default: true,
            description: t('surfaces.settings.automaticallyCreateCutCandidatesFillersRephrasingSilence.description')
        },
        [AKARI_QUALITY_TIER]: {
            type: 'string',
            enum: ['draft', 'final'],
            default: 'draft',
            description: t('surfaces.settings.akariVideoExportQualityTier.description')
        },
        [AKARI_PREVIEW_SCRUB_AUDIO]: {
            type: 'boolean', default: false,
            description: t('surfaces.akariPreferences.ui.playShortSampleAudioNewPositionWhenScrubbingMessage')
        },
        [AKARI_TIMELINE_VISUAL_THUMBNAILS]: {
            type: 'boolean', default: false,
            description: t('surfaces.settings.timelineHtmlThreeDimensionalThumbnail.description')
        },
        [AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY]: {
            type: 'string', enum: ['tag', 'switches'], default: 'tag',
            description: t('surfaces.settings.timelineDisplayTrackPackingMethodTagTarget.description')
        },
        [AKARI_AGENT_TURN_END_NOTIFICATION]: {
            type: 'boolean',
            default: true,
            description: t('surfaces.settings.sendsOsNotificationAiPartnerFinishesProcessing.description')
        }
    }
};

@injectable()
export class AkariPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_PREFERENCE_SCHEMA;
}
