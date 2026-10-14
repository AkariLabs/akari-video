export const AKARI_CHILD_LANGUAGE_PATH = '/services/akari-child-language';

export const AkariChildLanguageService = Symbol('AkariChildLanguageService');
export interface AkariChildLanguageService {
    setLanguage(choice: 'auto' | 'ja' | 'en'): Promise<void>;
}
