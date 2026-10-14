import { t } from './transcript-text';
import { Command } from '@theia/core/lib/common';

export const OPEN_AKARI_TRANSCRIPT: Command = {
    id: 'akari.transcript.open',
    label: t('transcript.transcript.command.openTranscriptLabel')
};

export const AKARI_TRANSCRIPT_SEEK_REQUESTED: Command = {
    id: 'akari.transcript.seekRequested'
};

export const OPEN_AKARI_DAIHON: Command = {
    id: 'akari.daihon.open',
    label: t('transcript.transcript.command.openScriptLabel')
};
