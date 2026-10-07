import { PreferenceContribution, PreferenceSchema, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { LISTENING_ENGINE_KEY, migrateVibeMode, VIBE_MODE_KEY } from '../common/vibe-mode';
import type { EarStatus } from '../common/ear-protocol';

export let lastKnownListeningMic: EarStatus['mic'] = 'unknown';
export function rememberListeningMic(mic: EarStatus['mic']): void {
    if (mic === 'ok' || mic === 'denied') { lastKnownListeningMic = mic; }
}

const schema: PreferenceSchema = { properties: {
    [VIBE_MODE_KEY]: {
        type: 'string', enum: ['off', 'screen', 'full'], default: 'off', scope: PreferenceScope.User,
        description: '声で画面や編集を動かす範囲'
    },
    [LISTENING_ENGINE_KEY]: {
        type: 'string', enum: ['auto', 'speechanalyzer-live', 'record-then-transcribe'],
        default: 'auto', scope: PreferenceScope.User, description: 'マイクで話すときの聞き取りエンジン'
    }
} };

@injectable()
export class ListeningPreferenceContribution implements PreferenceContribution {
    readonly schema = schema;
}

@injectable()
export class VibeModeMigration implements FrontendApplicationContribution {
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;

    async onStart(): Promise<void> {
        let storage: Storage;
        try {
            storage = window.localStorage;
            if (storage.getItem('akari.vibe.modeMigrated')) { return; }
        } catch { return; }
        await this.preferences.ready;
        try {
            const mode = migrateVibeMode({
                stored: this.preferences.inspect(VIBE_MODE_KEY)?.globalValue,
                privacyNoticeSeen: storage.getItem('akari.vibe.privacy-notice-v1') === 'seen'
            });
            if (mode) { await this.preferences.set(VIBE_MODE_KEY, mode, PreferenceScope.User); }
            storage.setItem('akari.vibe.modeMigrated', 'true');
        } catch { /* 保存先が使えなければ移行しない。 */ }
    }
}
