import { Command } from '@theia/core/lib/common';

export const OPEN_AKARI_TRANSCRIPT: Command = {
    id: 'akari.transcript.open',
    label: '文字起こしを開く'
};

export const AKARI_TRANSCRIPT_SEEK_REQUESTED: Command = {
    id: 'akari.transcript.seekRequested'
};
