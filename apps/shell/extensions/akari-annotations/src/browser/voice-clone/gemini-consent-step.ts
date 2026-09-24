import { GEMINI_CONSENT_TEXT, GEMINI_WATERMARK_NOTICE } from '../../common/voice-clone-model';
export { GEMINI_CONSENT_TEXT, GEMINI_WATERMARK_NOTICE, geminiConsentReady, geminiConsentCanNext,
    geminiConsentStatus, type GeminiConsentCheck } from '../../common/voice-clone-model';

/** ウィザードと設定の両方に同じ口頭同意の表示部品を置く。 */
export function createGeminiConsentPrompt(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.dataset.geminiConsentPrompt = 'true';
    const lead = document.createElement('p');
    lead.textContent = 'Google が指定した文を本人の声で読み上げてください。録音はこの PC で照合します。';
    const phrase = document.createElement('div');
    phrase.dataset.voiceScript = 'consent-gemini';
    phrase.dataset.geminiConsentScript = 'true';
    phrase.textContent = GEMINI_CONSENT_TEXT;
    Object.assign(phrase.style, { fontSize: '18px', lineHeight: '1.8', padding: '16px', border: '1px solid #777', borderRadius: '8px' });
    const watermark = document.createElement('p');
    watermark.dataset.geminiWatermark = 'true';
    watermark.textContent = GEMINI_WATERMARK_NOTICE;
    wrapper.append(lead, phrase, watermark);
    return wrapper;
}
