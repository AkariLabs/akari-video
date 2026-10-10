import { injectable } from '@theia/core/shared/inversify';
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { t } from '@akari-video/i18n';

@injectable()
export class AkariLocalizationContribution implements LocalizationContribution {
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        registry.registerLocalization({ languageId: 'ja', languageName: 'Japanese', localizedLanguageName: t('settings.appearance.language.ja', {}, 'ja'), languagePack: true, translations: {} });
        registry.registerLocalization({ languageId: 'en', languageName: 'English', localizedLanguageName: 'English', languagePack: true, translations: {} });
    }
}
