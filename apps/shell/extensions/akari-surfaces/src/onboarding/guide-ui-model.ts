import { AiAnswer, OnboardingStep } from './model';

export function guideShowsChat(step: OnboardingStep): boolean {
    return step.startsWith('tour') || ['prompt', 'work', 'play', 'caption'].includes(step);
}

/** Only steps targeting the chat raise and frame it. */
export function guideTargetsChat(step: OnboardingStep, sub: number): boolean {
    return (step === 'tour3' && sub === 0) || step === 'prompt' || step === 'work';
}

export function guideNeedsPartner(step: OnboardingStep): boolean {
    return step.startsWith('tour') || ['ask', 'prompt', 'work', 'play', 'caption'].includes(step);
}

export function askHighlightTarget(answer: AiAnswer | undefined): string {
    return ({ claude: 'partner-claude', chatgpt: 'partner-codex', google: 'partner-antigravity',
        none: 'partner', other: 'partner' } as Record<AiAnswer, string>)[answer ?? 'none'];
}

export function askConnectionCopy(answer: AiAnswer | undefined): string {
    return ({
        claude: 'Claude の Pro・Max なら、つなぐのは「Claude Code CLI」です（光っているところ）。',
        chatgpt: 'ChatGPT なら、つなぐのは「Codex CLI」です（光っているところ）。無料のアカウントでも使えます。',
        google: 'Google のアカウントなら、つなぐのは「Antigravity CLI」です（光っているところ）。',
        none: 'AI とつながなくても、流れはお手本で見られます。',
        other: 'お使いの AI は、あとでこの一覧からつなげます。'
    } as Record<AiAnswer, string>)[answer ?? 'none'];
}

/** A new entry always reveals the real panel, including a return to the same step. */
export function shouldRevealPartner(step: OnboardingStep, entrySerial: number, revealedSerial: number): boolean {
    return guideNeedsPartner(step) && entrySerial !== revealedSerial;
}

export interface GuideRect { x: number; y: number; width: number; height: number }

/** The play control shifts horizontally in a narrow preview, so frame the full transport row. */
export function materialPreviewTransportRect(frame: GuideRect): GuideRect {
    const height = Math.min(42, frame.height); // 34px controls and 8px seek/spacing above them.
    return { x: frame.x, y: frame.y + frame.height - height, width: frame.width, height };
}

/** Exactly the coach's holes, clear openings and rings receive input. */
export function guideInputCutouts(holes: GuideRect[], clear: GuideRect[], rings: GuideRect[]): GuideRect[] {
    return [...holes, ...clear, ...rings].filter(rect => rect.width > 0 && rect.height > 0);
}

export function pointInGuideCutouts(x: number, y: number, cutouts: GuideRect[]): boolean {
    return cutouts.some(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
}

/** Partition the viewport at every cutout edge, then merge blocked cells across each row. */
export function guideBlockedRects(width: number, height: number, cutouts: GuideRect[]): GuideRect[] {
    const clipped = cutouts.map(rect => ({
        left: Math.max(0, Math.min(width, rect.x)),
        top: Math.max(0, Math.min(height, rect.y)),
        right: Math.max(0, Math.min(width, rect.x + rect.width)),
        bottom: Math.max(0, Math.min(height, rect.y + rect.height))
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
    const xs = [...new Set([0, width, ...clipped.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b);
    const ys = [...new Set([0, height, ...clipped.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b);
    const blocked: GuideRect[] = [];
    for (let row = 0; row < ys.length - 1; row++) {
        let start: number | undefined;
        for (let column = 0; column < xs.length - 1; column++) {
            const centerX = (xs[column] + xs[column + 1]) / 2;
            const centerY = (ys[row] + ys[row + 1]) / 2;
            const open = clipped.some(rect => centerX >= rect.left && centerX <= rect.right
                && centerY >= rect.top && centerY <= rect.bottom);
            if (!open && start === undefined) start = xs[column];
            if (open && start !== undefined) {
                blocked.push({ x: start, y: ys[row], width: xs[column] - start, height: ys[row + 1] - ys[row] });
                start = undefined;
            }
        }
        if (start !== undefined) blocked.push({ x: start, y: ys[row], width: width - start, height: ys[row + 1] - ys[row] });
    }
    return blocked.filter(rect => rect.width > 0 && rect.height > 0);
}

export function guideBlockerClipPath(width: number, height: number, cutouts: GuideRect[]): string {
    const rectangle = (x: number, y: number, w: number, h: number): string =>
        `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    const blocked = guideBlockedRects(width, height, cutouts);
    if (!blocked.length) return 'inset(100%)';
    return `path("${blocked.map(rect => rectangle(rect.x, rect.y, rect.width, rect.height)).join('')}")`;
}

/** Synthetic clicks from assistStep have no pointer coordinates and must reach their target. */
export function shouldBlockGuidePointer(isTrusted: boolean, x: number, y: number, cutouts: GuideRect[]): boolean {
    return isTrusted && !pointInGuideCutouts(x, y, cutouts);
}

export function partnerFallbackReady(attempts: number, lastAttemptAt: number, now: number): boolean {
    return attempts >= 4 && now - lastAttemptAt >= 700;
}
