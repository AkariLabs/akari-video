import { injectable } from '@theia/core/shared/inversify';
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';

@injectable()
export class AkariLocalizationContribution implements LocalizationContribution {
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        // Do not register ja: marking it as a language pack would enable Theia's bundled Japanese translations.
        registry.registerLocalization({ languageId: 'en', languageName: 'English', localizedLanguageName: 'English', languagePack: true, translations: {} });
    }
}
