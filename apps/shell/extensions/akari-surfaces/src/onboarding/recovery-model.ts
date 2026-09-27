import { OnboardingStep } from './model';

export interface AutomaticGuideTransition {
    delayMs: number;
    kind: 'sub' | 'step';
    target: number | OnboardingStep;
}

export function automaticGuideTransition(step: OnboardingStep, sub: number): AutomaticGuideTransition | undefined {
    if (step === 'tour0' && sub === 0) return { delayMs: 2200, kind: 'sub', target: 1 };
    if (step === 'tour2' && sub === 0) return { delayMs: 2800, kind: 'sub', target: 1 };
    if (step === 'tour3' && sub === 1) return { delayMs: 2300, kind: 'step', target: 'drag' };
    return undefined;
}

export interface GuideRecoveryFacts {
    step: OnboardingStep;
    sub: number;
    elapsedMs: number;
    idleMs: number;
    hasVisibleAction: boolean;
    transitioning: boolean;
    failed: boolean;
}

export function guideRecoveryView(facts: GuideRecoveryFacts): {
    showFallbackNext: boolean;
    showIdleClose: boolean;
    showError: boolean;
    showRetry: boolean;
} {
    const automatic = automaticGuideTransition(facts.step, facts.sub);
    return {
        showFallbackNext: !!automatic && !facts.hasVisibleAction && !facts.transitioning && !facts.failed
            && facts.elapsedMs >= automatic.delayMs + 3000,
        showIdleClose: facts.step !== 'done' && !facts.failed && facts.idleMs >= 10000,
        showError: facts.failed,
        showRetry: facts.failed && !facts.transitioning
    };
}
