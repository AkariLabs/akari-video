import { OnboardingStep } from './model';

export function introVisual(step: OnboardingStep, busy = false): { hero: 'welcome' | 'before-after' | 'none'; brand: boolean } {
    if (busy) return { hero: 'none', brand: false };
    if (step === 'welcome') return { hero: 'welcome', brand: true };
    if (step === 'invite') return { hero: 'before-after', brand: false };
    return { hero: 'none', brand: false };
}

export const PREPARING_COPY = '準備しています…';

export function inviteMarkup(busy: boolean, escapedError: string): string {
    if (busy) return `<p>${PREPARING_COPY}</p>`;
    return `<h2>一緒に 1 本、つくってみませんか？</h2><p>用意した動画に、AI でタイトルと字幕を入れて、書き出すところまで。5 分ほどです。途中でやめても大丈夫です。</p>${escapedError ? `<p role="alert">${escapedError}</p>` : ''}<div class="ao-actions"><button class="primary" data-ao="start">${escapedError ? 'もう一度' : 'やってみる'}</button></div><div class="ao-secondary"><button data-ao="later">後で自分で始める</button></div>`;
}
