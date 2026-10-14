import { t } from '@akari-video/i18n';

export type PromptResult = 'typed' | 'unsupported' | 'no-partner' | 'copied';

export interface PromptHandoffPort {
    typePrompt(prompt: string): Promise<'typed' | 'unsupported' | 'no-partner' | undefined>;
    copy(prompt: string): Promise<void>;
    notify(message: string, openPartner?: string): Promise<boolean | void>;
    openPartner(): Promise<void>;
}

export async function handPromptToPartner(prompt: string, subject: string, port: PromptHandoffPort): Promise<PromptResult> {
    let result: Awaited<ReturnType<PromptHandoffPort['typePrompt']>>;
    try { result = await port.typePrompt(prompt); } catch { result = undefined; }
    if (result === 'typed') {
        await port.notify(t('annotationscommon.partnerHandoff.text.typed', { subject }));
        return result;
    }
    if (result === 'unsupported') {
        await port.notify(t('annotationscommon.partnerHandoff.text.unsupported'));
        return result;
    }
    try { await port.copy(prompt); } catch {
        await port.notify(t('annotationscommon.partnerHandoff.text.copyFailed', { prompt }));
        return 'copied';
    }
    if (result === 'no-partner') {
        const selected = await port.notify(t('annotationscommon.partnerHandoff.text.noPartner'), t('annotationscommon.partnerHandoff.text.openPartner'));
        if (selected) await port.openPartner();
        return 'no-partner';
    } else {
        await port.notify(t('annotationscommon.partnerHandoff.text.copied'));
    }
    return 'copied';
}
