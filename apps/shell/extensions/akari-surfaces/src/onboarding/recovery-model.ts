import { OnboardingStep } from './model';

export interface AutomaticGuideTransition {
    delayMs: number;
    kind: 'sub' | 'step';
    target: number | OnboardingStep;
}

export function automaticGuideTransition(step: OnboardingStep, sub: number): AutomaticGuideTransition | undefined {
    // The guide advances only when the person chooses an action.
    void step;
    void sub;
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
