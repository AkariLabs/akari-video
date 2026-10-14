import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';

export const HELPER_KINDS = ['default', 'design', 'words', 'skill', 'trend'] as const;
export type HelperKind = typeof HELPER_KINDS[number];
export const HELPER_KIND_LABELS: Record<HelperKind, string> = {
    default: t('surfaces.channel.usualRequest.label'), design: t('surfaces.channel.writeDesignMdPastVideos.label'), words: t('surfaces.channel.collectDictionaryCandidates.label'),
    skill: t('surfaces.channel.makeAskingOftenSkill.label'), trend: t('surfaces.channel.trendsChannel.message')
};
export const HELPER_ROW_DESCRIPTION = t('surfaces.channel.pastVideosConversationsProvideSuggestionsDesignDesign.label');
export const HELPER_CONSENT_TEXT = t('surfaces.channel.readsConversationsAnalysisNotesChannelsProjects.message');
export const HELPER_NO_PARTNER_TEXT = t('surfaces.channel.openPartnerPartnerRightAiArrange.label');

export function helperPrompt(kind: HelperKind, channelName: string): string {
    const name = t('surfaces.channel.helperPromptChannel.message', { channelName: channelName });
    switch (kind) {
        case 'default': return t('surfaces.channel.helperPromptReadEditJsonExportNotesPartnerConversations.message', { name: name });
        case 'design': return t('surfaces.channel.helperPromptReadEditJsonSuggestOneThreeSentences.message', { name: name });
        case 'words': return t('surfaces.channel.helperPromptReadTranscriptionCorrectionsPartnerConversationsSuggestOne.message', { name: name });
        case 'skill': return t('surfaces.channel.helperPromptReadHistoryConversationsSPartnersDraftOne.message', { name: name });
        case 'trend': return t('surfaces.channel.helperPromptReadEditJsonExportNotesSummarizeVideos.message', { name: name });
    }
}

export interface HelperConsent { version: 0; allowed_at: string }
export function parseHelperConsent(text: string | undefined): HelperConsent | undefined {
    if (!text) return undefined;
    try {
        const data: unknown = JSON.parse(text);
        if (typeof data !== 'object' || data === null || !('version' in data) || !('allowed_at' in data)
            || data.version !== 0 || typeof data.allowed_at !== 'string' || !data.allowed_at) return undefined;
        return { version: 0, allowed_at: data.allowed_at };
    } catch { return undefined; }
}
export function buildHelperConsent(now: string): string { return JSON.stringify({ version: 0, allowed_at: now }, null, 2); }

export function HelperConsentSheet(props: { channelName: string; onAllow: () => void; onCancel: () => void }): React.ReactElement {
    return React.createElement(HomeScrim, { kind: 'channel-helper-consent', onClose: props.onCancel, children: null },
        React.createElement('style', null, homePanelCss, channelSheetCss),
        React.createElement('h3', null, t('surfaces.channel.helperConsentSheetLetAiSortOut.label')),
        React.createElement('p', null, HELPER_CONSENT_TEXT),
        React.createElement('div', { className: 'akari-channel-sheet-actions' },
            React.createElement('button', { type: 'button', className: 'theia-button secondary', 'data-akari-helper-cancel': '', onClick: props.onCancel }, t('surfaces.channel.helperConsentSheetStop.label')),
            React.createElement('button', { type: 'button', className: 'theia-button main', 'data-akari-helper-allow': '', onClick: props.onAllow }, t('surfaces.channel.helperConsentSheetOkayRead.label'))));
}
