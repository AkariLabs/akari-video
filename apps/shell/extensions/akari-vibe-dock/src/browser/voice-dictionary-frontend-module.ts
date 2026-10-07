import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { PreferenceContribution, PreferenceSchema, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariVoiceDictionaryService, AKARI_VOICE_DICTIONARY_SERVICE_PATH } from '../common/voice-dictionary-protocol';
import { VoiceDictionaryDialog } from './voice-dictionary-dialog';
import { isVibePreviewEnabled } from '../common/vibe-preview';

const HISTORY_KEY = 'akari.listening.history';
const schema: PreferenceSchema = { properties: {
    [HISTORY_KEY]: { type: 'boolean', default: false, scope: PreferenceScope.User, description: '聞き取り履歴を残す' },
    'akari.listening.showCorrections': { type: 'boolean', default: true, scope: PreferenceScope.User, description: '直した語を帯に薄く示す' }
} };

@injectable()
export class VoiceDictionaryPreferenceContribution implements PreferenceContribution { readonly schema = schema; }

@injectable()
export class VoiceDictionaryFrontendContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(AkariVoiceDictionaryService) protected readonly service!: AkariVoiceDictionaryService;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: 'akari.voiceDictionary.open', label: '声の辞書を開く' }, {
            execute: () => isVibePreviewEnabled(window.localStorage) && new VoiceDictionaryDialog(this.service, this.preferences).open(),
            isEnabled: () => isVibePreviewEnabled(window.localStorage),
            isVisible: () => isVibePreviewEnabled(window.localStorage)
        });
    }

    onStart(): void {
        const synchronize = () => { void this.service.setHistoryEnabled(this.preferences.get<boolean>(HISTORY_KEY, false)).catch(() => {}); };
        const syncCorrections = () => {
            if (isVibePreviewEnabled(window.localStorage)) {
                document.documentElement.dataset.akariCorrections = String(this.preferences.get<boolean>('akari.listening.showCorrections', true));
            }
        };
        synchronize();
        syncCorrections();
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === HISTORY_KEY) synchronize();
            if (change.preferenceName === 'akari.listening.showCorrections') syncCorrections();
        });
    }
}

export default new ContainerModule(bind => {
    bind(AkariVoiceDictionaryService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(
        context.container, AKARI_VOICE_DICTIONARY_SERVICE_PATH
    )).inSingletonScope();
    bind(VoiceDictionaryPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(VoiceDictionaryPreferenceContribution);
    bind(VoiceDictionaryFrontendContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(VoiceDictionaryFrontendContribution);
    bind(FrontendApplicationContribution).toService(VoiceDictionaryFrontendContribution);
});
