import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AiAnswer, INITIAL_ONBOARDING_STATE, nextOnboardingState, OnboardingState, OnboardingStep,
    onboardingCount, onboardingRevisit, previousOnboardingStep } from './model';
import { AkariOnboardingService, SampleInformation } from './protocol';
import { ONBOARDING_CSS } from './style';
import { automaticGuideTransition, guideRecoveryView } from './recovery-model';

interface CoachSpec {
    key?: string;
    title: string;
    body: string;
    holes?: string[];
    clear?: string[];
    rings?: string[];
    labels?: string[];
    buttons?: Array<[string, string, boolean]>;
    choices?: Array<[AiAnswer, string, string]>;
    link?: [string, string];
    wide?: boolean;
    narrow?: boolean;
    noDim?: boolean;
    fullFog?: boolean;
    minimal?: boolean;
    bounce?: boolean;
    place?: 'left' | 'right' | 'top' | 'bottom';
}

const PROMPT = 'この動画を編集したいです。タイトルと字幕を入れて、話している内容に合わせて図解と BGM も入れてください。';
const HELP_DELAY = { hint: 4000, next: 10000 } as const;
const LOG: Array<{ t: number; lines: string[]; live?: string; count?: number; title?: boolean;
    captions?: boolean; figures?: number; bgm?: boolean; lint?: boolean }> = [
    { t: 500, live: '素材を確認しています…', lines: ['素材を確認します。'] },
    { t: 1300, lines: ['akari media probe assets/サンプル動画.mp4', '37.6 秒 · 1280×720 · 30fps · 音声あり'] },
    { t: 2300, live: '書き起こしを探しています…', lines: ['素材の書き起こしを使い、話の要点を確認しました。'] },
    { t: 3000, live: '本編を置いています…', lines: ['edit.json', '本編を置きました'], count: 0 },
    { t: 4000, live: '字幕を置いています…', lines: ['字幕を短く分けてつくりました → captions.json'], captions: true },
    { t: 7200, live: 'タイトルを置いています…', lines: ['右上にタイトルを置きました'], title: true },
    { t: 8100, live: '図解を置いています…', lines: ['「AI と対話」を図にしました'], figures: 1 },
    { t: 9000, lines: ['「話すだけで編集」を図にしました'], figures: 2 },
    { t: 9900, lines: ['「効果音とエフェクト」を図にしました'], figures: 3 },
    { t: 10800, lines: ['「図解とモックアップ」を図にしました'], figures: 4 },
    { t: 11700, lines: ['「BGM と字幕」を図にしました'], figures: 5 },
    { t: 12400, live: 'BGM を入れています…', lines: ['声の下に小さく BGM を入れました'], bgm: true },
    { t: 13200, live: '確認しています…', lines: ['edit-lint .', '問題なし'], lint: true },
    { t: 13700, live: 'できました', lines: ['できました。プレビューで再生して確かめてください。書き出しは左のメニューの「書き出し…」からできます。'] }
];
const esc = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

export class OnboardingController {
    protected state: OnboardingState = INITIAL_ONBOARDING_STATE;
    protected root: HTMLDivElement | undefined;
    protected hero = '';
    protected sample?: SampleInformation;
    protected videoUrl?: string;
    protected thumbnailUrl?: string;
    protected logLines: string[] = [];
    protected live = '素材を確認しています…';
    protected busy = false;
    protected prepareError = '';
    protected workError = false;
    protected promptTyped = '';
    protected timers: number[] = [];
    protected exportPoll?: number;
    protected exportFinishing = false;
    protected placeFrame?: number;
    protected lastRects = '';
    protected fogFrom: DOMRect[] = [];
    protected fogTo: DOMRect[] = [];
    protected fogFrame?: number;
    protected coachKey = '';
    protected coachToken = 0;
    protected dragStarted = false;
    protected dragHintTimer?: number;
    protected bounceTimer?: number;
    protected tourTimer?: number;
    protected sourceExample = false;
    protected helpTimers: number[] = [];
    protected helpKey = '';
    protected transitionBusy = false;
    protected transitionFailure?: { retry: () => Promise<void>; skipCleanup?: () => Promise<void> };
    protected tourCleanupFailed = false;
    protected recoveryTimers: number[] = [];
    protected stepEnteredAt = 0;
    protected lastInteractionAt = 0;
    protected idleCloseTimer?: number;
    protected stepSerial = 0;

    constructor(
        protected readonly service: AkariOnboardingService,
        protected readonly files: FileService,
        protected readonly openProject: (uri: string) => Promise<void>,
        protected readonly showOutput: (uri: string) => Promise<void>,
        protected readonly showAssets: () => Promise<void>,
        protected readonly seekOutput: (uri: string, time: number) => Promise<void>,
        protected readonly startOwnVideo: () => Promise<void>,
        protected readonly openGuideSettings: () => Promise<void>,
        protected readonly showClosedNotice: () => void
    ) {}

    async open(initial?: OnboardingState): Promise<void> {
        try { await this.openUnchecked(initial); }
        catch (error) { this.closeVisual(); throw error; }
    }

    protected async openUnchecked(initial?: OnboardingState): Promise<void> {
        this.closeVisual();
        this.state = initial ?? INITIAL_ONBOARDING_STATE;
        this.hero = await this.service.heroDataUrl();
        this.root = document.createElement('div');
        this.root.id = 'akari-onboarding-v1';
        this.root.setAttribute('data-akari-onboarding-step', this.state.step);
        this.root.innerHTML = `<style>${ONBOARDING_CSS}</style><div class="ao-example-host"></div><div class="ao-chat-host"></div><div class="ao-dim"></div><div class="ao-holes"></div><div class="ao-rings"></div><div class="ao-hint"></div><div class="ao-takeover-host"></div><div class="ao-finder-host"></div><div class="ao-coach-host"></div><div class="ao-recovery-host"></div><div class="ao-close-host"></div>`;
        this.root.addEventListener('click', event => void this.handleClick(event));
        this.root.addEventListener('dragstart', event => {
            if ((event.target as Element).closest('[data-ao-file]')) {
                event.dataTransfer?.setData('application/x-akari-onboarding-sample', 'sample');
                this.dragStarted = true;
                this.hideDragHint();
            }
        });
        this.root.addEventListener('dragend', () => {
            this.dragStarted = false;
            if (this.state.step === 'drag' && !this.state.imported) this.scheduleDragHint();
        });
        document.body.appendChild(this.root);
        document.body.classList.add('akari-onboarding-active');
        document.addEventListener('click', this.handleExternalClick, true);
        document.addEventListener('drop', this.handleDrop, true);
        document.addEventListener('dragover', this.handleDragOver, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('input', this.handleInput, true);
        window.addEventListener('akari.preview.playbackTick', this.handlePlayback as EventListener);
        window.addEventListener('akari.preview.captionSelected', this.handleCaptionSelection as EventListener);
        if (this.state.projectUri) {
            try {
                const prepared = await this.service.prepare();
                this.sample = prepared.sample;
                if (this.state.step !== 'invite') {
                    await this.showOutput(this.state.projectUri);
                    if (this.state.step === 'caption') await this.seekOutput(this.state.projectUri, 8.7);
                }
            } catch (error) {
                this.live = error instanceof Error ? error.message : String(error);
            }
        }
        this.render();
        this.followTargets();
        if (this.state.step === 'prompt' && this.state.sub === 0) this.startPromptTypewriter();
        if (this.state.step === 'work') void this.startWork();
        if (this.state.step === 'export' && this.state.sub >= 3) this.beginExportPoll();
        this.enterStep();
    }

    protected closeVisual(): void {
        for (const timer of this.recoveryTimers) window.clearTimeout(timer);
        this.recoveryTimers = [];
        if (this.idleCloseTimer) window.clearTimeout(this.idleCloseTimer);
        this.idleCloseTimer = undefined;
        this.stepSerial++;
        this.transitionFailure = undefined;
        this.transitionBusy = false;
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers = [];
        if (this.exportPoll) window.clearInterval(this.exportPoll);
        if (this.placeFrame) cancelAnimationFrame(this.placeFrame);
        if (this.fogFrame) cancelAnimationFrame(this.fogFrame);
        if (this.dragHintTimer) window.clearTimeout(this.dragHintTimer);
        if (this.bounceTimer) window.clearTimeout(this.bounceTimer);
        if (this.tourTimer) window.clearTimeout(this.tourTimer);
        this.clearHelp();
        this.root?.remove();
        this.root = undefined;
        document.body.classList.remove('akari-onboarding-active');
        document.body.classList.remove('akari-onboarding-chat-active');
        document.body.classList.remove('akari-onboarding-daihon-active');
        document.removeEventListener('click', this.handleExternalClick, true);
        document.removeEventListener('drop', this.handleDrop, true);
        document.removeEventListener('dragover', this.handleDragOver, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('input', this.handleInput, true);
        window.removeEventListener('akari.preview.playbackTick', this.handlePlayback as EventListener);
        window.removeEventListener('akari.preview.captionSelected', this.handleCaptionSelection as EventListener);
        if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
        this.videoUrl = undefined;
        this.thumbnailUrl = undefined;
    }

    async close(): Promise<void> {
        if (!this.root) return;
        this.closeVisual();
        this.showClosedNotice();
        try { await this.service.markSeen(); }
        catch (error) { console.error('[akari-onboarding] close marker could not be saved:', error); }
    }

    protected async go(step: OnboardingStep, sub = 0, skipCleanup = false): Promise<void> {
        await this.runTransition(() => this.goUnchecked(step, sub, skipCleanup), () => this.go(step, sub),
            skipCleanup ? undefined : () => this.go(step, sub, true));
    }

    protected async runTransition(operation: () => Promise<void>, retry: () => Promise<void>,
        skipCleanup?: () => Promise<void>): Promise<void> {
        if (!this.root || this.transitionBusy) return;
        this.transitionBusy = true;
        this.transitionFailure = undefined;
        this.tourCleanupFailed = false;
        this.renderRecovery();
        try { await operation(); }
        catch (error) {
            if (!this.root) return;
            console.error('[akari-onboarding] transition failed:', error);
            if (this.tourTimer) window.clearTimeout(this.tourTimer);
            this.clearHelp();
            this.transitionFailure = { retry, skipCleanup: this.tourCleanupFailed ? skipCleanup : undefined };
        } finally {
            this.transitionBusy = false;
            this.renderRecovery();
        }
    }

    protected async goUnchecked(step: OnboardingStep, sub = 0, skipCleanup = false): Promise<void> {
        this.clearHelp();
        if (this.dragHintTimer) window.clearTimeout(this.dragHintTimer);
        this.hideDragHint();
        if (this.tourTimer) window.clearTimeout(this.tourTimer);
        const old = this.state.step;
        if (old !== step) window.dispatchEvent(new Event('akari.onboarding.clearPreviewSelection'));
        if (step === 'drag' && this.state.exampleActive && !this.state.workCompleted && this.state.projectUri && this.sample) {
            if (!skipCleanup) {
                try { await this.service.resetTourExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments); }
                catch (error) { this.tourCleanupFailed = true; throw error; }
            }
            if (!this.root) return;
            // Skipping cleanup leaves the example asset in the project, ready for the existing imported branch.
            this.state = { ...this.state, exampleActive: false, imported: skipCleanup || this.state.imported };
            window.dispatchEvent(new Event('akari.onboarding.refreshProject'));
            window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
            await new Promise<void>(resolve => window.setTimeout(resolve, 450));
            if (!this.root) return;
        } else if (step.startsWith('tour') && !old.startsWith('tour') && !this.state.exampleActive
            && !this.state.workCompleted && this.state.projectUri && this.sample) {
            if (!this.state.imported) await this.service.importSample(this.state.projectUri, this.sample.sourcePath);
            if (!this.root) return;
            this.state = { ...this.state, exampleActive: true };
            await this.service.save(this.state);
            await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, this.sample.segments.length, true);
            if (!this.root) return;
            window.dispatchEvent(new Event('akari.onboarding.refreshProject'));
            window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
        }
        if (['welcome', 'first', 'invite'].includes(old)) {
            const take = this.root?.querySelector<HTMLElement>('.ao-takeover');
            take?.querySelector('.ao-text')?.classList.add('out');
            await new Promise<void>(resolve => window.setTimeout(resolve, 250));
            if (!this.root) return;
            if (step === 'tour0') {
                take?.classList.add('out');
                await new Promise<void>(resolve => window.setTimeout(resolve, 380));
                if (!this.root) return;
            }
        }
        if (step === 'matpreview' && this.state.materialOpened) sub = 1;
        if (step === 'play' && this.state.played) sub = 1;
        this.state = nextOnboardingState(this.state, step, sub);
        await this.service.save(this.state);
        if (!this.root) return;
        this.render();
        this.enterStep();
        if (old === 'matpreview' && (step === 'drag' || step === 'ask') && this.state.projectUri)
            await this.showOutput(this.state.projectUri);
        if (step === 'prompt') this.startPromptTypewriter();
        if (step === 'work') void this.startWork();
        if ((step === 'play' || step === 'caption') && this.state.projectUri)
            await this.seekOutput(this.state.projectUri, step === 'caption' ? 8.7 : 0);
        if (step === 'export') this.beginExportPoll();
        if (step === 'done') await this.service.markSeen();
    }

    protected async setSub(sub: number): Promise<void> {
        await this.runTransition(() => this.setSubUnchecked(sub), () => this.setSub(sub));
    }

    protected async setSubUnchecked(sub: number): Promise<void> {
        this.clearHelp();
        const next = { ...this.state, sub };
        await this.service.save(next);
        if (!this.root) return;
        this.state = next;
        this.render();
        this.enterStep();
    }

    protected enterStep(): void {
        for (const timer of this.recoveryTimers) window.clearTimeout(timer);
        this.recoveryTimers = [];
        this.stepEnteredAt = performance.now();
        this.lastInteractionAt = this.stepEnteredAt;
        const serial = ++this.stepSerial;
        this.scheduleHelp();
        if (this.tourTimer) window.clearTimeout(this.tourTimer);
        const automatic = automaticGuideTransition(this.state.step, this.state.sub);
        if (automatic) {
            this.tourTimer = window.setTimeout(() => {
                if (this.root && serial === this.stepSerial) void this.advanceAutomatically();
            }, automatic.delayMs);
            this.recoveryTimers.push(window.setTimeout(() => {
                if (this.root && serial === this.stepSerial) this.renderRecovery();
            }, automatic.delayMs + 3000));
        }
        this.scheduleIdleClose(serial);
        this.renderRecovery();
        if (this.state.step === 'drag' && !this.state.imported) this.scheduleDragHint();
        if (this.state.step === 'done') this.celebrate();
    }

    protected scheduleIdleClose(serial: number): void {
        if (this.idleCloseTimer) window.clearTimeout(this.idleCloseTimer);
        this.idleCloseTimer = undefined;
        if (this.state.step === 'done') return;
        this.idleCloseTimer = window.setTimeout(() => {
            if (this.root && serial === this.stepSerial) this.renderRecovery();
        }, 10000);
    }

    protected noteInteraction(): void {
        this.lastInteractionAt = performance.now();
        this.scheduleIdleClose(this.stepSerial);
        this.renderRecovery();
    }

    protected async advanceAutomatically(): Promise<void> {
        const transition = automaticGuideTransition(this.state.step, this.state.sub);
        if (!transition) return;
        if (transition.kind === 'sub') await this.setSub(transition.target as number);
        else await this.go(transition.target as OnboardingStep);
    }

    protected renderRecovery(): void {
        if (!this.root) return;
        const spec = this.coach();
        const view = guideRecoveryView({
            step: this.state.step, sub: this.state.sub,
            elapsedMs: Math.max(0, performance.now() - this.stepEnteredAt),
            idleMs: Math.max(0, performance.now() - this.lastInteractionAt),
            hasVisibleAction: !!(spec?.buttons?.length || spec?.choices?.length || spec?.link),
            transitioning: this.transitionBusy, failed: !!this.transitionFailure
        });
        const coach = this.root.querySelector<HTMLElement>('.ao-coach');
        const fallback = coach?.querySelector('[data-ao="fallback-next"]');
        if (view.showFallbackNext && coach && !fallback) {
            let actions = coach.querySelector<HTMLElement>('.ao-actions');
            if (!actions) { actions = document.createElement('div'); actions.className = 'ao-actions'; coach.appendChild(actions); }
            actions.insertAdjacentHTML('beforeend', '<button class="primary" data-ao="fallback-next">次へ →</button>');
            this.lastRects = '';
            this.placeCoach();
        } else if (!view.showFallbackNext) fallback?.remove();
        const closeHost = this.root.querySelector<HTMLElement>('.ao-close-host')!;
        if (view.showIdleClose && !closeHost.firstElementChild)
            closeHost.innerHTML = '<button class="ao-idle-close" data-ao="idle-close">ガイドを閉じる ×</button>';
        else if (!view.showIdleClose) closeHost.replaceChildren();
        const recoveryHost = this.root.querySelector<HTMLElement>('.ao-recovery-host')!;
        if (view.showError && !recoveryHost.firstElementChild) recoveryHost.innerHTML =
            '<div class="ao-transition-error" role="alert"><p>先へ進めませんでした。もう一度お試しください。</p><div class="ao-actions"><button class="primary" data-ao="retry-transition">もう一度</button><button data-ao="close-guide">ガイドを閉じる</button></div></div>';
        else if (!view.showError) recoveryHost.replaceChildren();
        const skipButton = recoveryHost.querySelector('[data-ao="skip-cleanup"]');
        if (view.showError && this.transitionFailure?.skipCleanup && !skipButton)
            recoveryHost.querySelector('.ao-actions')?.insertAdjacentHTML('beforeend',
                '<button data-ao="skip-cleanup">片付けを飛ばして次へ</button>');
        else if (!this.transitionFailure?.skipCleanup) skipButton?.remove();
        recoveryHost.querySelector<HTMLButtonElement>('[data-ao="retry-transition"]')?.toggleAttribute('disabled', !view.showRetry);
    }

    protected clearHelp(): void {
        for (const timer of this.helpTimers) window.clearTimeout(timer);
        this.helpTimers = [];
        this.helpKey = '';
    }

    protected waitingHint(): string | undefined {
        const { step, sub } = this.state;
        if (step === 'drag' && !this.state.imported) return 'サンプル動画を左の素材へドラッグしてください。';
        if (step === 'matpreview' && sub === 0) return '左のサンプル動画カードを押してください。';
        if (step === 'ask' && sub === 0) return '使っている AI を選んでください。';
        if (step === 'prompt') return sub === 0 ? '「入力欄に入れる」を押してください。' : '右の「送る」を押してください。';
        if (step === 'play' && sub === 0) return 'プレビューの ▶ を押してください。';
        if (step === 'caption' && sub < 3) return ['プレビューの字幕を押してください。', '上の「大きさ」を押してください。', 'つまみを動かしてください。'][sub];
        if (step === 'daihon' && sub < 2) return sub === 0 ? '右端の紙のアイコンを押してください。' : '光っている最初の行を押してください。';
        if (step === 'export' && sub < 3) return ['左上の ≡ を押してください。', '「書き出し…」を押してください。', '「書き出す」を押してください。'][sub];
        return undefined;
    }

    protected scheduleHelp(): void {
        this.clearHelp();
        const hint = this.waitingHint();
        if (!hint) return;
        const key = `${this.state.step}:${this.state.sub}`;
        this.helpKey = key;
        this.helpTimers.push(window.setTimeout(() => {
            if (!this.root || this.helpKey !== key) return;
            const body = this.root.querySelector<HTMLElement>('.ao-coach .ao-body');
            if (body && !body.querySelector('.ao-help')) body.insertAdjacentHTML('beforeend', `<p class="ao-help">${esc(hint)}</p>`);
            this.root.querySelector('.ao-ring, .ao-hole')?.classList.add('bounce');
            this.lastRects = '';
            this.placeCoach();
        }, HELP_DELAY.hint));
        this.helpTimers.push(window.setTimeout(() => {
            if (!this.root || this.helpKey !== key) return;
            const coach = this.root.querySelector<HTMLElement>('.ao-coach');
            if (!coach || coach.querySelector('[data-ao="help-next"]')) return;
            let actions = coach.querySelector<HTMLElement>('.ao-actions');
            if (!actions) { actions = document.createElement('div'); actions.className = 'ao-actions'; coach.appendChild(actions); }
            actions.insertAdjacentHTML('beforeend', '<button class="primary" data-ao="help-next">次へ</button>');
            this.lastRects = '';
            this.placeCoach();
        }, HELP_DELAY.next));
    }

    protected async assistStep(): Promise<void> {
        const { step, sub } = this.state;
        if (step === 'drag') return this.importSample();
        if (step === 'matpreview') {
            document.querySelector<HTMLElement>('[data-akari-onboarding-target="sample-card"]')?.click();
            this.state = { ...this.state, materialOpened: true };
            return this.setSub(1);
        }
        if (step === 'ask') { this.state = { ...this.state, answer: 'none' }; return this.setSub(1); }
        if (step === 'prompt') return sub === 0 ? this.setSub(1) : this.go('work');
        if (step === 'play') {
            document.querySelector<HTMLElement>('[data-akari-onboarding-target="play-button"]')?.click();
            this.state = { ...this.state, played: true };
            return this.setSub(1);
        }
        if (step === 'caption') {
            if (sub === 0) window.dispatchEvent(new Event('akari.onboarding.assistCaptionSelection'));
            if (sub === 1) document.querySelector<HTMLElement>('[data-akari-onboarding-target="caption-size"]')?.click();
            if (sub === 2) {
                const slider = document.querySelector<HTMLInputElement>('[data-akari-onboarding-target="caption-size-slider"]');
                if (slider) { slider.value = String(Math.min(Number(slider.max), Number(slider.value) + 2)); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            return this.setSub(sub + 1);
        }
        if (step === 'daihon') {
            document.querySelector<HTMLElement>(`[data-akari-onboarding-target="${sub === 0 ? 'daihon-button' : 'daihon-first-row'}"]`)?.click();
            return this.setSub(sub + 1);
        }
        if (step === 'export') {
            document.querySelector<HTMLElement>(`[data-akari-onboarding-target="${['menu-button', 'export-button', 'export-submit'][sub]}"]`)?.click();
        }
    }

    protected takeover(): string {
        const brand = '<div class="ao-brand">AKARI VIDEO</div>';
        if (this.state.step === 'welcome') return `${brand}<h2>AKARI Video へようこそ</h2><div class="ao-actions"><button class="primary" data-ao="next">次へ</button></div>`;
        if (this.state.step === 'first') return `${brand}<h2>AKARI Video を使うのは、はじめてですか？</h2><div class="ao-actions"><button class="primary" data-ao="yes">はじめて</button><button data-ao="no">使ったことがある</button></div>`;
        if (this.state.step === 'invite') return `${brand}<h2>一緒に 1 本、つくってみませんか？</h2><p>用意した動画に、AI でタイトルと字幕を入れて、書き出すところまで。5 分ほどです。途中でやめても大丈夫です。</p><div class="ao-chip">サンプル動画<small>0:37 · 話している人の動画 · 用意してあります</small></div>${this.busy ? '<p>準備しています… 作業場とプロジェクトを作っています</p>' : `${this.prepareError ? `<p role="alert">${esc(this.prepareError)}</p>` : ''}<div class="ao-actions"><button class="primary" data-ao="start">${this.prepareError ? 'もう一度' : 'やってみる'}</button><button data-ao="later">あとで（自分で始める）</button></div>`}`;
        return `<div class="ao-congrats">おめでとうございます</div><h2>はじめての 1 本ができました</h2><button class="ao-magic" data-ao="own"><span>自分の動画で始める</span><b>→</b><i>✦</i><i>✦</i><i>✦</i></button><div class="ao-secondary"><button data-ao="explore">このまま触ってみる</button><span>·</span><button data-ao="again">もう一度見る</button><span>·</span><button data-ao="learn">使い方を学ぶ</button></div>`;
    }

    protected coach(): CoachSpec | undefined {
        const sub = this.state.sub;
        switch (this.state.step) {
            case 'tour0': return sub === 0
                ? { title: '画面の構成を知りましょう', body: '', minimal: true, fullFog: true }
                : { title: 'これが AKARI Video の画面です', body: '', minimal: true, noDim: true,
                    buttons: [['次へ →', 'next', false]] };
            case 'tour1': return { title: '① 左は「素材」です', holes: ['assets'], labels: ['① 素材'],
                body: '<p>使う動画や写真を、ここに入れます。入れたものはカードで並びます。</p>', buttons: [['次へ', 'next', true]] };
            case 'tour2': return sub === 0
                ? { title: '② 上は「プレビュー」です', holes: ['output'], labels: ['② 上: プレビュー'],
                    body: '<p>仕上がりを再生して確かめる場所です。</p>', buttons: [['次へ', 'next', true]] }
                : { title: '② 下は「タイムライン」です', holes: ['timeline'], labels: ['② 下: タイムライン'],
                    body: '<p>動画・字幕・音が、時間の順に並びます。</p>', buttons: [['次へ', 'next', true]] };
            case 'tour3': return sub === 0
                ? { title: '③ 右は「AI パートナー」です', holes: ['replay-chat'], labels: ['③ AI パートナー'], place: 'left',
                    body: '<p>やりたいことを文章で頼むと、AI が編集を進めます。</p><p>右のように、頼んだことと AI の返事が並びます。</p>', buttons: [['次へ', 'next', true]] }
                : { title: 'では、これを一緒につくってみましょう', body: '', minimal: true, fullFog: true };
            case 'drag': return this.state.imported
                ? { title: '素材はもう入っています', holes: ['assets'], body: '<p>次へ進みましょう。</p>', buttons: [['次へ', 'next', true]] }
                : { title: 'まず素材を入れます', holes: ['assets'], rings: ['finder-file'], wide: true,
                body: `<p>用意した動画を、左の「素材」へドラッグしてください。</p><p class="ao-note">${navigator.platform.includes('Mac') ? 'Finder' : 'エクスプローラー'}の右側で、中身を再生して確かめられます。</p>`,
                link: ['import', 'ドラッグしづらいときは、ここを押して入れる'] };
            case 'matpreview': return sub === 0
                ? { title: '素材を押すと、中身が見られます', clear: ['assets'], rings: ['sample-card'], body: '<p>入った動画を押してみてください。</p>' }
                : { title: 'ここは「素材プレビュー」です', holes: ['material-preview'], body: '<p>取り込んだ素材を、そのまま再生して確かめられます。確かめたら次へ。</p>', buttons: [['次へ', 'next', true]] };
            case 'ask': return sub === 0
                ? { title: '編集は、右の AI に頼みます', holes: ['partner'], rings: ['answer-choices'], wide: true, place: 'left',
                    body: '<p>やりたいことを文章で伝えると、AI がタイムラインを組み立てます。いま使っている AI はありますか？</p>',
                    choices: [['claude', 'Claude', 'Pro・Max'], ['chatgpt', 'ChatGPT', '無料のアカウントでも可'], ['google', 'Google', 'AI Pro・無料のアカウント'], ['none', 'どれも使っていない', ''], ['other', 'ほかの AI', 'Cursor・Copilot・Devin など']] }
                : { title: '今回は、お手本で流れを見ます', holes: [this.state.answer === 'claude' ? 'partner-claude' : this.state.answer === 'chatgpt' ? 'partner-codex' : this.state.answer === 'google' ? 'partner-antigravity' : 'partner'], wide: true, place: 'left',
                    body: `<p>${({ claude: 'Claude の Pro・Max なら、つなぐのは「Claude Code CLI」です（光っているところ）。', chatgpt: 'ChatGPT なら、つなぐのは「Codex CLI」です（光っているところ）。無料のアカウントでも使えます。', google: 'Google のアカウントなら、つなぐのは「Antigravity CLI」です（光っているところ）。', none: 'AI とつながなくても、流れはお手本で見られます。', other: 'お使いの AI は、あとでこの一覧からつなげます。' } as Record<AiAnswer, string>)[this.state.answer ?? 'none']}</p><p>このあとは AI を使わずに、頼んでから仕上がるまでをお手本で再生します。本物の AI とは、最後につなげます。</p>`,
                    buttons: [['お手本を始める', 'replay', true]], link: ['reanswer', '選び直す'] };
            case 'prompt': return onboardingRevisit(this.state) === 'completed'
                ? { title: 'お手本はもう終わっています', clear: ['replay-chat'], rings: ['replay-input'], place: 'left',
                    body: '<p>もう一度見るか、次へ進みます。</p>', buttons: [['もう一度見る', 'again-work', false], ['次へ', 'next', true]] }
                : sub === 0
                ? { title: 'AI には、こう頼みます', clear: ['replay-chat'], rings: ['replay-input'], wide: true, place: 'left',
                    body: `<div class="ao-prompt-entry">「<span class="ao-typed">${esc(this.promptTyped)}</span><span aria-hidden="true">▍</span>」</div><p class="ao-note">自分で打っても大丈夫です。</p>`,
                    buttons: [['コピー', 'copy', false], ['入力欄に入れる', 'insert', true]] }
                : { title: '「送る」を押してください', clear: ['replay-chat'], rings: ['replay-input'], place: 'left',
                    body: '<p>ここから先は、用意したお手本を再生します。AI は使いません。</p>', buttons: [['送る', 'send', true]] };
            case 'work': return { title: 'AI が編集しています', noDim: true, narrow: true,
                body: `<p class="ao-live">${esc(this.live)}</p><p>下のタイムラインと上のプレビューに、AI が置いたものが増えていきます。</p><p class="ao-note">お手本は約 15 秒です。実際には数分かかることがあります（未計測）。</p>`,
                buttons: this.workError ? [['もう一度', 'retry-work', true]] : undefined };
            case 'play': return sub === 0 ? { title: 'できました。再生してみましょう', clear: ['output'], rings: ['play-button'], bounce: true, body: '<p>▶ を押してください。</p>' }
                : { title: 'タイトル・字幕・図解・BGM が入りました', holes: ['output'], body: '<p>止めるときは、もう一度 ▶ を押します。見終わったら次へ。</p>', buttons: [['次へ', 'next', true]] };
            case 'caption': return ([
                { title: '字幕を押すと、その場で直せます', clear: ['output'], rings: ['caption-text'], body: '<p>プレビューの字幕を押してください。</p>' },
                { title: '大きさを変えてみましょう', clear: ['output'], rings: ['caption-size'], body: '<p>上に出たメニューの「大きさ」を押します。</p>' },
                { title: 'つまみを動かしてみてください', clear: ['output'], rings: ['caption-size-slider'], body: '<p>いまは全部の字幕が一緒に変わります。字幕の上の小さなボタンで「この字幕だけ」にも切り替えられます。</p>' },
                { title: '位置も動かせます', clear: ['output'], rings: ['caption-text'], body: '<p>字幕をドラッグすると上下に動きます。文字を直すときはダブルクリック。</p>', buttons: [['次へ', 'next', true]] }
            ] as CoachSpec[])[Math.min(sub, 3)];
            case 'daihon': return sub === 0
                ? { title: '字幕の全文は「台本」で見られます', clear: ['daihon-button'], rings: ['daihon-button'], bounce: true, place: 'left',
                    body: '<p>字幕はタイムラインでも見られますが、全文を通して読みたいときは右の「台本」で。</p><p>右端のアイコンで、右のパネルの中身を切り替えられます。紙のアイコンを押してください。</p>' }
                : sub === 1 ? { title: 'この行を押してみてください', clear: ['daihon', 'output'], rings: ['daihon-first-row'], place: 'top',
                    body: '<p>右の台本の最初の行を押すと、その場面へ飛びます。</p>' }
                : { title: 'プレビューがこの場面へ飛びました', clear: ['daihon', 'output'], place: 'top',
                    body: '<p>ダブルクリックで文字も直せます。AI パートナーへは右端のいちばん上のアイコンから戻れます。</p>', buttons: [['次へ', 'next', true]] };
            case 'export': return ([
                { title: '書き出しは、左のメニューから', clear: ['menu-button'], rings: ['menu-button'], bounce: true, body: '<p>≡ を押してください。</p>' },
                { title: '「書き出し…」を押します', clear: ['menu-panel'], rings: ['export-button'], bounce: true, body: '<p>編集データ（edit.json）ができていると押せます。</p>' },
                { title: '標準のまま「書き出す」', clear: ['export-dialog'], rings: ['export-submit'], bounce: true, place: 'top', body: '<p>画質や保存先は、ここで変えられます。</p>' },
                { title: '書き出しています', noDim: true, rings: ['export-progress'], place: 'bottom', body: '<p>進み具合は右下に出ます。そのまま作業を続けても大丈夫です。</p>' },
                { title: '書き出せました', clear: ['assets'], rings: ['export-result'], body: '<p>できたファイルは「できたもの」に並びます。</p><p>AI パートナーに「書き出して」と頼んでも書き出せます（中身を見せて、確認してから実行します）。</p>', buttons: [['次へ', 'next', true]] }
            ] as CoachSpec[])[Math.min(sub, 4)];
            default: return undefined;
        }
    }

    protected finder(): string {
        if (this.state.step !== 'drag' || this.state.imported) return '';
        const mac = navigator.platform.includes('Mac');
        const paths: Record<string, string> = {
            back: 'M15 4l-8 8 8 8', next: 'M9 4l8 8-8 8', up: 'M12 19V5m-6 6 6-6 6 6', refresh: 'M20 12a8 8 0 1 1-3-6m3-2v5h-5',
            plus: 'M12 4v16M4 12h16', cut: 'M4 4l16 16M20 4L4 20M7 17a3 3 0 1 0 0 6 3 3 0 0 0 0-6m10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
            copy: 'M8 8h12v13H8zM4 17V4h12', paste: 'M8 4h8l2 3v14H6V7l2-3zm2 0v3h4V4', rename: 'M4 19h16M8 15l9-9 3 3-9 9-4 1z',
            share: 'M12 16V3m-5 5 5-5 5 5M5 15v6h14v-6', delete: 'M4 7h16M8 7l1 14h6l1-14M9 4h6', sort: 'M7 4v16m-3-3 3 3 3-3m7 3V4m-3 3 3-3 3 3', view: 'M4 5h7v6H4zm9 0h7v6h-7zM4 13h7v6H4zm9 0h7v6h-7z',
            folder: 'M3 6h7l2 2h9v12H3z', search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16m6 14 5 5', film: 'M4 3h16v18H4zM4 8h16M4 16h16M8 3v18M16 3v18'
        };
        const icon = (name: string): string => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
        const nav = (mac ? ['お気に入り', '最近使った項目', 'アプリケーション', 'デスクトップ', 'ダウンロード', '書類', 'ピクチャ', 'ミュージック', 'ムービー', 'iCloud Drive']
            : ['ホーム', 'ギャラリー', 'OneDrive', 'デスクトップ', 'ダウンロード', 'ドキュメント', 'ピクチャ', 'ミュージック', 'ビデオ', 'PC'])
            .map(label => `<div class="ao-f-nav">${icon('folder')}<span>${label}</span></div>`).join('');
        const commands = mac ? `${icon('view')} 表示 <span class="ao-f-sep"></span> ${icon('share')} 共有` : `${icon('plus')} 新規作成 ▾ <span class="ao-f-sep"></span> ${['cut', 'copy', 'paste', 'rename', 'share', 'delete'].map(icon).join('')} <span class="ao-f-sep"></span> ${icon('sort')} 並べ替え ▾ ${icon('view')} 表示 ▾ …`;
        return `<div class="ao-finder ${mac ? 'mac' : 'windows'}" data-akari-onboarding-target="finder"><div class="ao-f-title"><span class="ao-f-tab">${icon('folder')} AKARI サンプル <span>×</span></span><span class="ao-f-title-end">${mac ? '● ● ●' : '− □ ×'}</span></div><div class="ao-f-toolbar">${commands}</div><div class="ao-f-address">${icon('back')}${icon('next')}${icon('up')}${icon('refresh')}<span class="ao-f-breadcrumb">${mac ? 'Finder' : 'PC'} › ビデオ › AKARI サンプル</span><span class="ao-f-search">${icon('search')} 検索</span></div><div class="ao-f-body"><div class="ao-f-side">${nav}</div><div class="ao-f-files"><div class="ao-f-file" data-ao-file draggable="true">${icon('film')}<span>サンプル動画.mp4<small>ここからドラッグ</small></span></div></div><div class="ao-f-preview"><div>詳細</div><video ${this.videoUrl ? `src="${this.videoUrl}"` : ''} muted autoplay loop playsinline></video><b>サンプル動画.mp4</b><small>種類 MPEG-4 ムービー<br>長さ 00:37<br>サイズ 1280×720</small></div></div><div class="ao-f-status">1 個の項目 <span>1 個選択</span></div></div>`;
    }

    protected chat(): string {
        const tour = this.state.step.startsWith('tour');
        if (!tour && !['prompt', 'work', 'play', 'caption'].includes(this.state.step)) return '';
        const lines = tour ? [`完成例です。この動画は、AI にこう頼んでつくりました。`, `> ${PROMPT}`, ...LOG.flatMap(entry => entry.lines)] : this.logLines;
        return `<div class="ao-chat" data-akari-onboarding-target="replay-chat"><h3>${tour ? 'AI パートナー（完成例）' : 'お手本（AI なし）'}</h3><div class="ao-chat-log">${lines.map(esc).join('\n')}</div><textarea class="ao-chat-input" data-akari-onboarding-target="replay-input" ${this.state.step === 'prompt' && !this.state.workCompleted ? '' : 'readonly'}>${this.state.step === 'prompt' && this.state.sub && !this.state.workCompleted ? esc(PROMPT) : ''}</textarea><button data-ao="send" ${this.state.step === 'prompt' && this.state.sub && !this.state.workCompleted ? '' : 'disabled'}>送る</button></div>`;
    }

    protected render(): void {
        if (!this.root) return;
        const takeover = ['welcome', 'first', 'invite', 'done'].includes(this.state.step);
        const spec = this.coach();
        this.root.setAttribute('data-akari-onboarding-step', this.state.step);
        document.body.classList.toggle('akari-onboarding-chat-active',
            this.state.step.startsWith('tour') || ['prompt', 'work', 'play', 'caption'].includes(this.state.step));
        document.body.classList.toggle('akari-onboarding-daihon-active', this.state.step === 'daihon');
        const takeHost = this.root.querySelector<HTMLElement>('.ao-takeover-host')!;
        if (takeover) {
            const intro = this.state.step !== 'done';
            if (takeHost.dataset.kind !== (intro ? 'intro' : 'done')) {
                takeHost.dataset.kind = intro ? 'intro' : 'done';
                takeHost.innerHTML = intro
                    ? `<div class="ao-takeover"><div class="ao-takeover-inner"><div class="ao-hero">${this.hero ? `<img src="${this.hero}" alt="">` : ''}</div><div class="ao-text in"></div></div></div>`
                    : `<div class="ao-takeover ao-done"><div class="ao-celebrate"></div><div class="ao-text in"></div></div>`;
            }
            if (takeHost.dataset.step !== this.state.step || this.state.step === 'invite') {
                takeHost.dataset.step = this.state.step;
                const textNode = takeHost.querySelector<HTMLElement>('.ao-text')!;
                textNode.innerHTML = this.takeover();
                textNode.classList.remove('out', 'in');
                void textNode.offsetWidth;
                textNode.classList.add('in');
            }
            takeHost.querySelector('.ao-hero')?.classList.toggle('small', this.state.step !== 'welcome');
        } else { takeHost.replaceChildren(); takeHost.dataset.kind = ''; takeHost.dataset.step = ''; }
        this.root.querySelector<HTMLElement>('.ao-finder-host')!.innerHTML = this.finder();
        this.root.querySelector<HTMLElement>('.ao-chat-host')!.innerHTML = this.chat();
        const exampleHost = this.root.querySelector<HTMLElement>('.ao-example-host')!;
        if (this.state.step.startsWith('tour')) {
            if (!exampleHost.firstElementChild) exampleHost.innerHTML = `<div class="ao-example-preview"><video muted autoplay loop playsinline></video><div class="ao-example-title">AI と話すだけで動画編集</div><div class="ao-example-caption"></div><span class="ao-example-tag">完成例</span></div>`;
            if (!this.videoUrl) void this.loadVideo();
            else {
                const video = exampleHost.querySelector<HTMLVideoElement>('video');
                if (video && video.src !== this.videoUrl) { video.src = this.videoUrl; void video.play().catch(() => undefined); }
            }
        } else exampleHost.replaceChildren();
        const coachHost = this.root.querySelector<HTMLElement>('.ao-coach-host')!;
        const key = spec ? `${this.state.step}:${this.state.sub}:${onboardingRevisit(this.state) ?? ''}` : '';
        if (key !== this.coachKey) {
            this.coachKey = key;
            const token = ++this.coachToken;
            const mount = (): void => {
                if (token !== this.coachToken || !this.root) return;
                coachHost.innerHTML = spec ? this.coachMarkup(spec) : '';
                this.lastRects = '';
                this.placeCoach();
                this.timers.push(window.setTimeout(() => this.placeCoach(), 450));
                if (spec?.bounce) this.bounceTimer = window.setTimeout(() => this.root?.querySelector('.ao-ring')?.classList.add('bounce'), 3000);
            };
            if (coachHost.firstElementChild && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
                coachHost.firstElementChild.classList.add('out');
                this.timers.push(window.setTimeout(mount, 170));
            } else mount();
        } else if (spec) {
            const live = coachHost.querySelector<HTMLElement>('.ao-live');
            if (live) live.textContent = this.live;
        }
        this.placeCoach();
        if (this.state.step === 'drag' && !this.videoUrl) void this.loadVideo();
    }

    protected coachMarkup(spec: CoachSpec): string {
        const actions = (spec.buttons ?? []).map(([label, action, primary]) => `<button data-ao="${action}" class="${primary ? 'primary' : ''}">${label}</button>`).join('');
        const icon: Record<AiAnswer, string> = {
            claude: '<span class="akari-partner-claude-cli-icon"></span>',
            chatgpt: '<span class="akari-partner-codex-cli-icon"></span>',
            google: '<svg class="ao-google" viewBox="0 0 24 24" aria-label="Google"><path fill="#4285F4" d="M21.35 12.22c0-.69-.06-1.37-.18-2.03H12v3.84h5.24a4.48 4.48 0 0 1-1.95 2.94v2.45h3.16c1.85-1.7 2.9-4.21 2.9-7.2z"/><path fill="#34A853" d="M12 21.5c2.64 0 4.86-.88 6.48-2.38l-3.16-2.45c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.48-4.03H3.26v2.53A9.8 9.8 0 0 0 12 21.5z"/><path fill="#FBBC05" d="M6.52 13.58a5.9 5.9 0 0 1 0-3.76V7.29H3.26a9.8 9.8 0 0 0 0 8.82l3.26-2.53z"/><path fill="#EA4335" d="M12 5.79c1.43 0 2.72.49 3.74 1.47l2.8-2.8A9.41 9.41 0 0 0 12 2.1a9.8 9.8 0 0 0-8.74 5.19l3.26 2.53C7.29 7.51 9.45 5.79 12 5.79z"/></svg>', none: '<span class="ao-choice-symbol">⊘</span>', other: '<span class="ao-choice-symbol">⌑</span>'
        };
        const choices = spec.choices?.map(([answer, label, note]) => `<button data-ao="answer" data-answer="${answer}"><span class="ao-choice-icon">${icon[answer]}</span><span>${label}${note ? `<small>${note}</small>` : ''}</span></button>`).join('') ?? '';
        const count = onboardingCount(this.state.step);
        const eyebrow = this.state.step.startsWith('tour') ? '画面を知る' : count ? `STEP ${count.current} / ${count.total}` : '';
        const back = previousOnboardingStep(this.state.step) && !spec.minimal ? '<button class="ao-back" data-ao="back">← 戻る</button>' : '';
        return `<div class="ao-coach ${spec.wide ? 'wide' : ''} ${spec.narrow ? 'narrow' : ''} ${spec.minimal ? 'minimal' : ''}" role="dialog" aria-live="polite">${eyebrow && !spec.minimal ? `<div class="ao-count">${eyebrow}</div>` : ''}<h3>${spec.title}</h3><div class="ao-body">${spec.body}</div>${choices ? `<div class="ao-choices">${choices}</div>` : ''}${spec.link ? `<button class="ao-link" data-ao="${spec.link[0]}">${spec.link[1]}</button>` : ''}${back || actions ? `<div class="ao-actions">${back}${actions}</div>` : ''}</div>`;
    }

    protected async loadVideo(): Promise<void> {
        if (!this.sample || this.videoUrl) return;
        try {
            const content = await this.files.readFile(URI.fromFilePath(this.sample.sourcePath));
            this.videoUrl = URL.createObjectURL(new Blob([new Uint8Array(content.value.buffer)], { type: 'video/mp4' }));
            const video = this.root?.querySelector<HTMLVideoElement>('.ao-f-preview video');
            if (video) { video.src = this.videoUrl; void video.play().catch(() => undefined); }
            const example = this.root?.querySelector<HTMLVideoElement>('.ao-example-preview video');
            if (example) { example.src = this.videoUrl; void example.play().catch(() => undefined); }
            const thumbnailVideo = document.createElement('video');
            thumbnailVideo.muted = true;
            thumbnailVideo.src = this.videoUrl;
            thumbnailVideo.addEventListener('loadeddata', () => {
                const canvas = document.createElement('canvas');
                canvas.width = 160;
                canvas.height = 90;
                canvas.getContext('2d')?.drawImage(thumbnailVideo, 0, 0, 160, 90);
                this.thumbnailUrl = canvas.toDataURL('image/jpeg', .8);
                if (this.root?.querySelector('.ao-hint svg')) this.showDragHint();
            }, { once: true });
        } catch { /* The import action remains available when preview decoding is unavailable. */ }
    }

    protected followTargets(): void {
        if (!this.root) return;
        this.placeCoach();
        this.placeFrame = requestAnimationFrame(() => this.followTargets());
    }

    protected placeCoach(): void {
        if (!this.root) return;
        const spec = this.coach();
        const dim = this.root.querySelector<HTMLElement>('.ao-dim');
        const coach = this.root.querySelector<HTMLElement>('.ao-coach');
        if (!spec || !dim) { dim?.classList.add('clear'); return; }
        const rectOf = (name: string): DOMRect | undefined => {
            let element = document.querySelector<HTMLElement>(`[data-akari-onboarding-target="${name}"]`);
            if (name === 'export-dialog') element = document.querySelector<HTMLElement>('[data-akari-onboarding-target="export-submit"]')?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
            if (!element && name === 'caption-text') element = document.querySelector<HTMLElement>('[data-akari-onboarding-target="output"] #caption-plate .caption-row-plate:not([hidden])');
            const rect = element?.getBoundingClientRect();
            return rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
        };
        const chat = this.root.querySelector<HTMLElement>('.ao-chat');
        const partner = rectOf('partner');
        if (chat && partner) Object.assign(chat.style, {
            left: `${partner.left}px`, top: `${partner.top}px`, width: `${partner.width}px`, height: `${partner.height}px`
        });
        const framed = (spec.holes ?? []).map(rectOf).filter((rect): rect is DOMRect => !!rect);
        const clear = (spec.clear ?? []).map(rectOf).filter((rect): rect is DOMRect => !!rect);
        const ring = spec.rings?.[0] ? rectOf(spec.rings[0]) : undefined;
        const all = [...framed, ...clear];
        const serial = JSON.stringify([this.state.step, this.state.sub, ...all.map(rect => [rect.x, rect.y, rect.width, rect.height]), ring && [ring.x, ring.y, ring.width, ring.height]]);
        if (serial === this.lastRects) return;
        this.lastRects = serial;
        dim.classList.toggle('clear', !!spec.noDim);
        if (spec.noDim || spec.fullFog || !all.length) this.paintFog([]);
        else this.animateFog(all, framed.length, spec.labels);
        if (!spec.noDim && !spec.fullFog && !all.length) dim.classList.remove('clear');
        const rings = this.root.querySelector<HTMLElement>('.ao-rings')!;
        if (ring) {
            if (!rings.firstElementChild) rings.innerHTML = '<div class="ao-ring"></div>';
            const element = rings.firstElementChild as HTMLElement;
            Object.assign(element.style, { left: `${ring.x - 5}px`, top: `${ring.y - 5}px`, width: `${ring.width + 10}px`, height: `${ring.height + 10}px` });
        } else rings.replaceChildren();
        const example = this.root.querySelector<HTMLElement>('.ao-example-preview');
        const output = rectOf('output');
        if (example && output) {
            Object.assign(example.style, { left: `${output.x + 8}px`, top: `${output.y + 38}px`, width: `${Math.max(0, output.width - 16)}px`, height: `${Math.max(0, output.height - 54)}px` });
            const video = example.querySelector('video');
            const caption = example.querySelector<HTMLElement>('.ao-example-caption');
            if (video && caption && this.sample) {
                const item = this.sample.segments.find(segment => video.currentTime >= segment.start && video.currentTime < segment.end);
                caption.textContent = item?.text ?? '';
            }
        }
        if (this.root.querySelector('.ao-hint svg')) this.showDragHint();
        if (!coach) return;
        const anchor = ring ?? framed[0] ?? clear[0];
        if (this.state.step === 'daihon' && this.state.sub > 0) {
            coach.style.width = `${Math.max(190, (rectOf('output')?.left ?? 250) - 26)}px`;
        }
        const width = coach.offsetWidth, height = coach.offsetHeight;
        let x = anchor ? anchor.right + 14 : (innerWidth - width) / 2;
        let y = anchor ? anchor.top + (anchor.height - height) / 2 : (innerHeight - height) / 2;
        if (spec.minimal) { x = (innerWidth - width) / 2; y = innerHeight * (spec.noDim ? .66 : .42) - height / 2; }
        else if (spec.place === 'left') x = (anchor?.left ?? innerWidth / 2) - width - 14;
        else if (spec.place === 'top') { x = (anchor?.left ?? innerWidth / 2) + ((anchor?.width ?? 0) - width) / 2; y = (anchor?.top ?? innerHeight / 2) - height - 14; }
        else if (spec.place === 'bottom') { x = (anchor?.left ?? innerWidth / 2) + ((anchor?.width ?? 0) - width) / 2; y = (anchor?.bottom ?? innerHeight / 2) + 14; }
        if (x + width > innerWidth - 12 && anchor) x = anchor.left - width - 14;
        if (x < 8 && anchor && !spec.minimal) x = anchor.right + 14;
        if (this.state.step === 'work') { x = 20; y = innerHeight * .53; }
        if (this.state.step === 'drag') { x = (anchor?.right ?? 240) + 14; y = innerHeight - height - 24; }
        if (this.state.step === 'daihon' && this.state.sub > 0) { x = 12; y = 66; }
        coach.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
        coach.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 32))}px`;
    }

    protected paintFog(rects: DOMRect[], framed = 0, labels?: string[]): void {
        if (!this.root) return;
        const dim = this.root.querySelector<HTMLElement>('.ao-dim')!;
        const holes = this.root.querySelector<HTMLElement>('.ao-holes')!;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><defs><mask id="m"><rect width="100%" height="100%" fill="white"/>${rects.map(rect => `<rect x="${rect.x - 4}" y="${rect.y - 4}" width="${rect.width + 8}" height="${rect.height + 8}" rx="12" fill="black"/>`).join('')}</mask></defs><rect width="100%" height="100%" fill="black" mask="url(#m)"/></svg>`;
        const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
        dim.style.maskImage = mask;
        dim.style.webkitMaskImage = mask;
        holes.innerHTML = rects.slice(0, framed).map((rect, index) => `<div class="ao-hole" style="left:${rect.x - 4}px;top:${rect.y - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px">${labels?.[index] ? `<span class="ao-hole-label">${labels[index]}</span>` : ''}</div>`).join('');
    }

    protected animateFog(target: DOMRect[], framed: number, labels?: string[]): void {
        if (this.fogFrame) cancelAnimationFrame(this.fogFrame);
        const current = this.fogFrom.length === target.length ? this.fogFrom : target.map(() => this.fogFrom.length === 1 ? this.fogFrom[0] : new DOMRect(0, 0, innerWidth, innerHeight));
        const from = current.map(rect => new DOMRect(rect.x, rect.y, rect.width, rect.height));
        const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700;
        const started = performance.now();
        const draw = (now: number): void => {
            const t = duration ? Math.min(1, (now - started) / duration) : 1;
            const eased = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            this.fogFrom = target.map((rect, index) => new DOMRect(
                from[index].x + (rect.x - from[index].x) * eased,
                from[index].y + (rect.y - from[index].y) * eased,
                from[index].width + (rect.width - from[index].width) * eased,
                from[index].height + (rect.height - from[index].height) * eased));
            this.paintFog(this.fogFrom, framed, t === 1 ? labels : undefined);
            if (t < 1) this.fogFrame = requestAnimationFrame(draw);
        };
        this.fogFrame = requestAnimationFrame(draw);
    }

    protected scheduleDragHint(): void {
        if (this.dragHintTimer) window.clearTimeout(this.dragHintTimer);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.dragHintTimer = window.setTimeout(() => {
            if (this.state.step === 'drag' && !this.state.imported && !this.dragStarted) this.showDragHint();
        }, 2500);
    }

    protected hideDragHint(): void {
        const host = this.root?.querySelector<HTMLElement>('.ao-hint');
        if (host) { host.replaceChildren(); host.dataset.geometry = ''; }
    }

    protected showDragHint(): void {
        const host = this.root?.querySelector<HTMLElement>('.ao-hint');
        const file = this.root?.querySelector<HTMLElement>('.ao-f-file');
        const assets = document.querySelector<HTMLElement>('[data-akari-onboarding-target="assets"]');
        if (!host || !file || !assets || this.dragStarted || this.state.step !== 'drag') return;
        const a = file.getBoundingClientRect(), b = assets.getBoundingClientRect();
        const x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
        const x2 = b.left + b.width / 2, y2 = b.top + b.height * .3;
        const geometry = [x1, y1, x2, y2, innerWidth, innerHeight, this.thumbnailUrl].join(':');
        if (host.dataset.geometry === geometry) return;
        host.dataset.geometry = geometry;
        const path = `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)} ${(Math.min(y1, y2) - 110).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        host.innerHTML = `<svg width="${innerWidth}" height="${innerHeight}" viewBox="0 0 ${innerWidth} ${innerHeight}"><defs><marker id="ao-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fb923c"/></marker></defs><path class="ao-hint-path" d="${path}" fill="none" stroke="#fb923c" stroke-width="3.5" stroke-dasharray="10 8" stroke-linecap="round" marker-end="url(#ao-arrow)"/><g>${this.thumbnailUrl ? `<image href="${this.thumbnailUrl}" x="-36" y="-20" width="72" height="40"/>` : '<rect x="-36" y="-20" width="72" height="40" fill="#714327"/>'}<rect x="-36" y="-20" width="72" height="40" fill="none" stroke="white"/><animateMotion dur="2.2s" repeatCount="indefinite" path="${path}" keyPoints="0;1;1" keyTimes="0;.75;1" calcMode="linear"/></g><text x="${x2.toFixed(1)}" y="${(y2 + 52).toFixed(1)}" text-anchor="middle" class="ao-hint-label">ここへドラッグ</text></svg>`;
    }

    protected celebrate(): void {
        const host = this.root?.querySelector<HTMLElement>('.ao-celebrate');
        if (!host || host.childElementCount || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const colors = ['#f97316', '#fdba74', '#facc15', '#f472b6', '#34d399', '#60a5fa', '#fff', '#a78bfa'];
        const random = (min: number, max: number): number => min + Math.random() * (max - min);
        const width = innerWidth, height = innerHeight;
        const piece = (): HTMLElement => {
            const item = document.createElement('i');
            item.className = 'ao-confetti';
            item.style.background = colors[Math.floor(Math.random() * colors.length)];
            item.style.width = `${random(6, 11)}px`;
            item.style.height = `${random(8, 18)}px`;
            host.appendChild(item);
            return item;
        };
        for (const flip of [false, true]) {
            const cone = document.createElement('div');
            cone.className = 'ao-popper';
            cone.style.left = `${flip ? width - 160 : 50}px`;
            cone.style.top = `${height - 170}px`;
            cone.innerHTML = `<svg viewBox="0 0 120 120" width="120" height="120" style="transform:scaleX(${flip ? -1 : 1})"><path d="M12 110 L42 30 L92 80 Z" fill="#f97316"/><path d="M24 86 L62 62 M31 66 L72 45" stroke="#fff9" stroke-width="6" stroke-linecap="round"/><g stroke="#facc15" stroke-width="4"><path d="M78 40 L98 14"/><path d="M86 54 L114 42"/><path d="M64 28 L70 2"/></g></svg>`;
            host.appendChild(cone);
            cone.animate([{ transform: 'scale(.2) rotate(-24deg)', opacity: 0 }, { transform: 'scale(1.18) rotate(8deg)', opacity: 1, offset: .2 }, { transform: 'scale(1)', opacity: 1, offset: .62 }, { transform: `translate(${flip ? 110 : -110}px,160px) rotate(25deg)`, opacity: 0 }], { duration: 1500, fill: 'forwards' });
            for (let index = 0; index < 65; index++) {
                const item = piece(), ox = flip ? width - 105 : 105, oy = height - 130;
                const vx = (flip ? -1 : 1) * random(120, 650), rise = random(300, 670);
                item.animate([{ transform: `translate(${ox}px,${oy}px)` }, { transform: `translate(${ox + vx * .5}px,${oy - rise}px) rotate(340deg)`, offset: .3 }, { transform: `translate(${ox + vx}px,${height + 40}px) rotate(900deg)` }], { duration: random(2600, 4200), delay: random(140, 320), fill: 'forwards' });
            }
        }
        for (let index = 0; index < 70; index++) {
            const item = piece(), x = random(0, width), sway = random(-90, 90);
            item.animate([{ transform: `translate(${x}px,-30px)` }, { transform: `translate(${x + sway}px,${height * .4}px) rotate(340deg)`, offset: .45 }, { transform: `translate(${x - sway}px,${height + 30}px) rotate(800deg)` }], { duration: random(3200, 5200), delay: random(450, 1700), fill: 'forwards' });
        }
        for (let index = 0; index < 9; index++) {
            const streamer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            streamer.setAttribute('viewBox', '-40 0 80 320');
            streamer.setAttribute('class', 'ao-streamer');
            streamer.style.left = `${random(40, width - 120)}px`;
            streamer.innerHTML = `<path d="M0 0 C30 30,-30 60,0 90 c22 0 22 -28 0 -28 c-22 0 -22 28 0 28 S34 150,0 180 S-30 230,0 260 c18 0 18 -24 0 -24 c-18 0 -18 24 0 24" fill="none" stroke="${colors[index]}" stroke-width="6" stroke-linecap="round" pathLength="1"/>`;
            host.appendChild(streamer);
            const path = streamer.querySelector('path')!;
            path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1300, delay: index * 75 + 250, fill: 'forwards' });
            streamer.animate([{ transform: 'translateY(-330px)' }, { transform: `translateY(${height + 20}px) rotate(25deg)` }], { duration: random(3600, 5200), delay: index * 75 + 250, fill: 'forwards' });
        }
        this.timers.push(window.setTimeout(() => host.replaceChildren(), 7600));
    }

    protected nudge(): void {
        const coach = this.root?.querySelector('.ao-coach');
        coach?.classList.remove('nudge');
        void (coach as HTMLElement | null)?.offsetWidth;
        coach?.classList.add('nudge');
    }

    protected handleClick = async (event: MouseEvent): Promise<void> => {
        const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ao]') : null;
        if (!element) return;
        const action = element.dataset.ao;
        if (action !== 'idle-close' && action !== 'close-guide') this.noteInteraction();
        if (action === 'idle-close' || action === 'close-guide') return this.close();
        if (action === 'retry-transition') {
            const retry = this.transitionFailure?.retry;
            if (retry) await retry();
            return;
        }
        if (action === 'skip-cleanup') {
            const skipCleanup = this.transitionFailure?.skipCleanup;
            if (skipCleanup) await skipCleanup();
            return;
        }
        if (action === 'fallback-next') return this.advanceAutomatically();
        if (action === 'next') {
            const step = this.state.step;
            if (step === 'welcome') return this.go('first');
            if (step === 'tour0' && this.state.sub === 1) return this.go('tour1');
            if (step === 'tour2' && this.state.sub === 0) return this.setSub(1);
            if (step === 'tour3' && this.state.sub === 0) return this.setSub(1);
            if (step === 'prompt' && this.state.workCompleted) return this.go('play');
            if (step === 'drag' && this.state.imported) return this.go('matpreview');
            if (['tour0', 'matpreview', 'play', 'caption', 'daihon', 'export'].includes(step)
                && (step === 'tour0' ? this.state.sub < 1 : step === 'caption' ? this.state.sub < 3
                    : step === 'export' ? this.state.sub < 4 : step === 'daihon' ? this.state.sub < 2 : this.state.sub < 1)) return this.nudge();
            const next: Partial<Record<OnboardingStep, OnboardingStep>> = {
                tour1: 'tour2', tour2: 'tour3', matpreview: 'ask', play: 'caption', caption: 'daihon',
                daihon: 'export', export: 'done'
            };
            if (next[step]) await this.go(next[step]!);
        } else if (action === 'yes') await this.go('invite');
        else if (action === 'back') {
            const previous = previousOnboardingStep(this.state.step);
            if (previous) await this.go(previous);
        }
        else if (action === 'no' || action === 'later') { await this.service.returnToHome(); this.closeVisual(); }
        else if (action === 'start') await this.prepare();
        else if (action === 'import') await this.importSample();
        else if (action === 'answer') {
            const answer = element.dataset.answer as AiAnswer;
            this.state = { ...this.state, answer };
            (window as Window & { akariOnboardingAnswer?: AiAnswer }).akariOnboardingAnswer = answer;
            window.dispatchEvent(new CustomEvent('akari.onboarding.answer', { detail: { answer } }));
            await this.setSub(1);
        } else if (action === 'reanswer') await this.setSub(0);
        else if (action === 'replay') await this.go('prompt');
        else if (action === 'again-work') {
            this.state = { ...this.state, workCompleted: false };
            await this.service.save(this.state);
            await this.go('work');
        }
        else if (action === 'copy') void navigator.clipboard.writeText(PROMPT);
        else if (action === 'insert') await this.setSub(1);
        else if (action === 'send' && this.state.step === 'prompt' && this.state.sub > 0) await this.go('work');
        else if (action === 'retry-work' && this.state.step === 'work') void this.startWork();
        else if (action === 'help-next') await this.assistStep();
        else if (action === 'learn') { this.closeVisual(); await this.openGuideSettings(); }
        else if (action === 'explore') this.closeVisual();
        else if (action === 'own') { this.closeVisual(); await this.startOwnVideo(); }
        else if (action === 'again') { await this.service.save(INITIAL_ONBOARDING_STATE); await this.open(); }
    };

    protected async prepare(): Promise<void> {
        this.busy = true;
        this.prepareError = '';
        this.render();
        try {
            const prepared = await this.service.prepare();
            this.sample = prepared.sample;
            this.state = { ...this.state, projectUri: prepared.projectUri, samplePath: prepared.sample.sourcePath, exampleActive: true };
            await this.service.save(this.state);
            await this.service.importSample(prepared.projectUri, prepared.sample.sourcePath);
            await this.service.writeExample(prepared.projectUri, prepared.sample.sourcePath, prepared.sample.segments, prepared.sample.segments.length, true);
            await this.go('tour0');
            if (this.transitionFailure) { this.busy = false; return; }
            await this.openProject(prepared.projectUri);
            await this.showOutput(prepared.projectUri);
        } catch (error) {
            this.prepareError = error instanceof Error && /network|fetch|ECONN|ENOTFOUND|timeout|ETIMEDOUT/i.test(error.message)
                ? 'サンプル素材を取得できませんでした。インターネット接続を確認してください。'
                : 'サンプル素材の準備に失敗しました。保存先と空き容量を確認してください。';
            this.busy = false;
            this.render();
        }
    }

    protected startPromptTypewriter(): void {
        this.promptTyped = '';
        const characters = [...PROMPT];
        let index = 0;
        const tick = (): void => {
            if (!this.root || this.state.step !== 'prompt' || this.state.sub !== 0) return;
            this.promptTyped += characters[index++];
            const typed = this.root.querySelector<HTMLElement>('.ao-typed');
            if (typed) typed.textContent = this.promptTyped;
            if (index < characters.length) this.timers.push(window.setTimeout(tick, 35));
        };
        this.timers.push(window.setTimeout(tick, 320));
    }

    protected async importSample(): Promise<void> {
        if (!this.state.projectUri || !this.sample || this.busy) return;
        this.busy = true;
        try {
            await this.service.importSample(this.state.projectUri, this.sample.sourcePath);
            this.state = { ...this.state, imported: true };
            window.dispatchEvent(new Event('akari.onboarding.refreshProject'));
            await new Promise<void>(resolve => window.setTimeout(resolve, 450));
            await this.go('matpreview');
        } catch (error) { this.live = error instanceof Error ? error.message : String(error); this.nudge(); }
        finally { this.busy = false; }
    }

    protected handleExternalClick = (event: MouseEvent): void => {
        if (!this.root || this.root.contains(event.target as Node)) return;
        this.noteInteraction();
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-akari-onboarding-target]') : null;
        const name = target?.dataset.akariOnboardingTarget;
        if (this.state.step === 'matpreview' && name === 'sample-card' && this.state.sub === 0) {
            this.state = { ...this.state, materialOpened: true };
            void this.setSub(1);
        }
        else if (this.state.step === 'caption' && name === 'caption-size' && this.state.sub === 1) void this.setSub(2);
        else if (this.state.step === 'daihon' && name === 'daihon-button' && this.state.sub === 0) void this.setSub(1);
        else if (this.state.step === 'daihon' && name === 'daihon-first-row' && this.state.sub === 1) void this.setSub(2);
        else if (this.state.step === 'export') {
            const expected = ['menu-button', 'export-button', 'export-submit'][this.state.sub];
            if (name === expected) void this.setSub(this.state.sub + 1);
            else this.nudge();
        } else if (!['drag', 'play', 'caption', 'matpreview'].includes(this.state.step)) this.nudge();
    };

    protected handleDragOver = (event: DragEvent): void => {
        if (this.state.step === 'drag' && event.dataTransfer?.types.includes('application/x-akari-onboarding-sample')) event.preventDefault();
    };

    protected handleDrop = (event: DragEvent): void => {
        if (this.state.step !== 'drag' || !event.dataTransfer?.types.includes('application/x-akari-onboarding-sample')) return;
        const target = event.target instanceof Element ? event.target.closest('[data-akari-onboarding-target="assets"]') : null;
        if (!target) return this.nudge();
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.importSample();
    };

    protected handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.root) { event.stopImmediatePropagation(); void this.close(); }
        else if (this.root) this.noteInteraction();
    };

    protected handleInput = (event: Event): void => {
        if (this.state.step === 'caption' && this.state.sub === 2 && event.target instanceof Element
            && event.target.matches('[data-akari-onboarding-target="caption-size-slider"]')) void this.setSub(3);
    };

    protected handlePlayback = (event: CustomEvent<{ playing?: boolean }>): void => {
        if (this.state.step === 'play' && this.state.sub === 0 && event.detail?.playing) {
            this.state = { ...this.state, played: true };
            void this.setSub(1);
        }
    };

    protected handleCaptionSelection = (event: CustomEvent<{ captionId?: string }>): void => {
        if (this.state.step === 'caption' && this.state.sub === 0 && event.detail?.captionId) void this.setSub(1);
    };

    protected async startWork(): Promise<void> {
        if (!this.state.projectUri || !this.sample || this.busy) return;
        this.busy = true;
        this.workError = false;
        this.logLines = [`> ${PROMPT}`];
        this.render();
        const started = performance.now();
        const staged = this.service as AkariOnboardingService & { writeExample(
            projectUri: string, sourcePath: string, segments: SampleInformation['segments'],
            count: number, title: boolean, progress: { figures: number; bgm: boolean }): Promise<void> };
        try {
            for (const entry of LOG) {
                await new Promise<void>(resolve => {
                    this.timers.push(window.setTimeout(resolve, Math.max(0, entry.t - (performance.now() - started))));
                });
                if (!this.root || this.state.step !== 'work') return;
                this.live = entry.live ?? this.live;
                if (entry.count === 0) {
                    await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, 0, false);
                    window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
                    await this.seekOutput(this.state.projectUri, 1).catch(() => undefined);
                }
                if (entry.captions) {
                    for (let count = 1; count <= this.sample.segments.length; count++) {
                        await new Promise<void>(resolve => { this.timers.push(window.setTimeout(resolve, Math.max(75, Math.floor(3150 / this.sample!.segments.length)))); });
                        if (!this.root || this.state.step !== 'work') return;
                        await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, count, false);
                        window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
                        this.live = `字幕を置いています…（${count}/${this.sample.segments.length}）`;
                        this.render();
                        const segment = this.sample.segments[count - 1];
                        await this.seekOutput(this.state.projectUri, (segment.start + segment.end) / 2).catch(() => undefined);
                    }
                }
                if (entry.title) {
                    await staged.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments,
                        this.sample.segments.length, true, { figures: 0, bgm: false });
                    window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
                    await this.seekOutput(this.state.projectUri, 8.6).catch(() => undefined);
                }
                if (entry.figures !== undefined || entry.bgm) {
                    await staged.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments,
                        this.sample.segments.length, true, { figures: entry.figures ?? 5, bgm: !!entry.bgm });
                    window.dispatchEvent(new Event('akari.onboarding.refreshTimeline'));
                    if (entry.figures !== undefined) {
                        const moments = [9.4, 12.7, 18.5, 24, 29.5];
                        await this.seekOutput(this.state.projectUri, moments[entry.figures - 1]).catch(() => undefined);
                    }
                }
                if (entry.lint) {
                    const errors = await this.service.lintExample(this.state.projectUri);
                    if (errors !== 0) throw new Error(`edit-lint: ${errors} 件の指摘`);
                }
                this.logLines.push(...entry.lines);
                this.render();
            }
            await new Promise<void>(resolve => { this.timers.push(window.setTimeout(resolve, 700)); });
            if (this.root && this.state.step === 'work') {
                this.state = { ...this.state, workCompleted: true };
                await this.service.save(this.state);
                await this.go('play');
            }
        } catch (error) {
            console.error('[akari-surfaces] onboarding replay failed', error);
            this.workError = true;
            this.live = 'お手本の保存ができませんでした。書き込み状態を確認して、もう一度お試しください。';
            this.render();
        } finally { this.busy = false; }
    }

    protected beginExportPoll(): void {
        if (this.exportPoll) window.clearInterval(this.exportPoll);
        this.exportPoll = window.setInterval(() => {
            if (this.state.step !== 'export' || this.state.sub !== 3 || !this.state.projectUri || this.exportFinishing) return;
            void this.service.hasExport(this.state.projectUri).then(async found => {
                if (!found || this.state.step !== 'export' || this.state.sub !== 3 || this.exportFinishing) return;
                const dialog = document.querySelector<HTMLElement>('.akari-export-dialog-host');
                if (dialog && !dialog.textContent?.includes('書き出し完了')) return;
                this.exportFinishing = true;
                try {
                    dialog?.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')?.click();
                    await this.showAssets();
                    window.dispatchEvent(new Event('akari.onboarding.refreshProject'));
                    await this.setSub(4);
                } finally { this.exportFinishing = false; }
            });
        }, 1000);
    }

}
