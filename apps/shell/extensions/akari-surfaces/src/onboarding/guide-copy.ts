import { OnboardingState } from './model';

export const HELP_DELAY = { hint: 4000, next: 1500 } as const;

export interface GuideCopy { title: string; body: string }

export const MATERIAL_PREVIEW_SELECT_COPY: GuideCopy = {
    title: '素材を押すと、中身が見られます',
    body: '<p>入った動画を押してみてください。</p>'
};

export const CAPTION_GUIDE_COPY: readonly GuideCopy[] = [
    { title: '字幕を押すと、その場で直せます', body: '<p>映像の下に出る字幕を選びましょう。</p>' },
    { title: '見た目を変えてみましょう', body: '<p>上のメニューで色などを自由に試せます。できたら次へ。</p>' },
    { title: '位置も動かせます', body: '<p>字幕をドラッグすると上下に動きます。文字を直すときはダブルクリック。</p>' }
];

export const DAIHON_GUIDE_COPY: readonly GuideCopy[] = [
    { title: '字幕の全文は「台本」で見られます', body: '<p>右端の紙のアイコンを押すと、字幕をまとめて読めます。</p>' },
    { title: 'この行を押してみてください', body: '<p>右の台本の最初の行を押すと、その場面へ飛びます。</p>' },
    { title: 'プレビューがこの場面へ飛びました',
        body: '<p>ダブルクリックで文字も直せます。AI パートナーへは右端のいちばん上のアイコンから戻れます。</p>' }
];

/** A hint is useful only when it adds a clue absent from the coach copy. */
export function guideWaitingHint(state: OnboardingState): string | undefined {
    if (state.step === 'matpreview' && state.sub === 0) return '左のサンプル動画カードを押してください。';
    return undefined;
}

/** The escape button remains available even when repeating a hint would add nothing. */
export function guideOffersHelpNext(state: OnboardingState): boolean {
    if (guideWaitingHint(state)) return true;
    if (state.step === 'drag') return !state.imported;
    if (state.step === 'ask') return state.sub === 0;
    if (state.step === 'prompt') return !state.workCompleted && state.sub <= 1;
    if (state.step === 'export') return state.sub <= 2;
    if (state.step === 'play' || state.step === 'caption') return state.sub === 0;
    return state.step === 'daihon' && state.sub <= 1;
}
