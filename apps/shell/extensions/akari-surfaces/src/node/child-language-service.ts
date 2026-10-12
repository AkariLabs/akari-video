import { injectable } from '@theia/core/shared/inversify';
import { setChildProcessLanguage } from '@akari-video/i18n';
import { AkariChildLanguageService } from '../common/child-language-protocol';

@injectable()
export class AkariChildLanguageServiceImpl implements AkariChildLanguageService {
    async setLanguage(choice: 'auto' | 'ja' | 'en'): Promise<void> {
        setChildProcessLanguage(choice);
    }
}
