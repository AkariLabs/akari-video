import { t } from '@akari-video/i18n';
import { OnboardingState } from './model';

export const HELP_DELAY = { hint: 4000, next: 1500 } as const;

export interface GuideCopy { title: string; body: string }

export const MATERIAL_PREVIEW_SELECT_COPY: GuideCopy = {
    title: t('surfaces.onboarding.pressAssetSeeContents.title'),
    body: t('surfaces.onboarding.tryClickingIncludedVideo.description')
};

export const CAPTION_GUIDE_COPY: readonly GuideCopy[] = [
    { title: t('surfaces.onboarding.clickCaptionFixSpot.title'), body: t('surfaces.onboarding.selectCaptionsAppearBelowVideo.description') },
    { title: t('surfaces.onboarding.letsChangeLook.title'), body: t('surfaces.onboarding.freelyTryOutColorsEtcMenuAbove.description') },
    { title: t('surfaces.onboarding.alsoMovePosition.title'), body: t('surfaces.onboarding.dragCaptionMoveUpDownDoubleClick.description') }
];

export const DAIHON_GUIDE_COPY: readonly GuideCopy[] = [
    { title: t('surfaces.onboarding.fullTextCaptionsSeenScript.title'), body: t('surfaces.onboarding.clickPaperIconFarRightReadAll.description') },
    { title: t('surfaces.onboarding.selectRow.title'), body: t('surfaces.onboarding.pressFirstLineScriptRightJumpScene.description') },
    { title: t('surfaces.onboarding.previewJumpedScene.title'),
        body: t('surfaces.onboarding.alsoEditTextDoubleClickingReturnAi.description') }
];

/** A hint is useful only when it adds a clue absent from the coach copy. */
export function guideWaitingHint(state: OnboardingState): string | undefined {
    if (state.step === 'matpreview' && state.sub === 0) return t('surfaces.onboarding.guideWaitingHintSelectSampleVideoCardLeft.message');
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
