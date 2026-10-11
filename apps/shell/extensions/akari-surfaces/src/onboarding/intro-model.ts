import { t } from '@akari-video/i18n';
import { OnboardingStep } from './model';

export function introVisual(step: OnboardingStep, busy = false): { hero: 'welcome' | 'before-after' | 'none'; brand: boolean } {
    if (busy) return { hero: 'none', brand: false };
    if (step === 'welcome') return { hero: 'welcome', brand: true };
    if (step === 'invite') return { hero: 'before-after', brand: false };
    return { hero: 'none', brand: false };
}

export const PREPARING_COPY = t('surfaces.onboarding.preparing.label');

export function inviteMarkup(busy: boolean, escapedError: string): string {
    if (busy) return `<p>${PREPARING_COPY}</p>`;
    return t('surfaces.onboarding.inviteMarkupLikeMakeOneTogetherAddTitlesCaptions.message', { error: escapedError ? `<p role="alert">${escapedError}</p>` : '', action: escapedError ? t('surfaces.onboarding.inviteMarkupOnceAgain.label') : t('surfaces.onboarding.inviteMarkupTry.label') });
}
