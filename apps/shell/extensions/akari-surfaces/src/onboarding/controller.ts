import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AiAnswer, INITIAL_ONBOARDING_STATE, nextOnboardingState, OnboardingState, OnboardingStep, ONBOARDING_STEPS, partnerToConnect } from './model';
import { AkariOnboardingService, SampleInformation } from './protocol';
import { ONBOARDING_CSS } from './style';

interface CoachSpec {
    title: string;
    body: string;
    targets?: string[];
    labels?: string[];
    buttons?: Array<[string, string, boolean]>;
    choices?: Array<[AiAnswer, string, string]>;
    link?: [string, string];
    wide?: boolean;
    narrow?: boolean;
    noDim?: boolean;
}

const PROMPT = 'この動画を編集したいです。右上に動画のタイトルを入れて、下に字幕を入れてください。';
const LOG: Array<{ t: number; lines: string[]; live?: string; count?: number; title?: boolean }> = [
    { t: 500, live: '素材を確認しています…', lines: ['素材を確認します。'] },
    { t: 1400, lines: ['akari media probe assets/サンプル動画.mp4', '37.6 秒 · 1280×720 · 30fps · 音声あり'] },
    { t: 2500, live: '書き起こしを探しています…', lines: ['素材に書き起こしが付いていたので、それを使います（文字起こしは不要でした）。'] },
    { t: 3500, live: '本編を置いています…', lines: ['edit.json', '本編を置きました'], count: 0 },
    { t: 4500, live: '字幕を置いています…', lines: ['akari captions .', '字幕を 7 行つくりました → captions.json'] },
    { t: 8100, live: 'タイトルを考えています…', lines: ['話の中心は「AI と話すだけで編集が終わる」なので、タイトルは「AI と話すだけで、動画編集」にします。'] },
    { t: 9200, live: 'タイトルを置いています…', lines: ['edit.json', '右上にタイトルを置きました'], title: true },
    { t: 10200, live: '確認しています…', lines: ['edit-lint .', '問題なし'] },
    { t: 11100, live: 'できました', lines: ['できました。プレビューで再生して確かめてください。書き出しは左のメニューの「書き出し…」からできます。'] }
];
const esc = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

export class OnboardingController {
    protected state: OnboardingState = INITIAL_ONBOARDING_STATE;
    protected root: HTMLDivElement | undefined;
    protected hero = '';
    protected sample?: SampleInformation;
    protected videoUrl?: string;
    protected logLines: string[] = [];
    protected live = '素材を確認しています…';
    protected busy = false;
    protected prepareError = '';
    protected workError = false;
    protected promptTyped = '';
    protected timers: number[] = [];
    protected exportPoll?: number;
    protected placeFrame?: number;
    protected lastRects = '';

    constructor(
        protected readonly service: AkariOnboardingService,
        protected readonly files: FileService,
        protected readonly openProject: (uri: string) => Promise<void>,
        protected readonly showOutput: (uri: string) => Promise<void>,
        protected readonly showPartner: () => Promise<void>,
        protected readonly seekOutput: (uri: string, time: number) => Promise<void>,
        protected readonly startOwnVideo: () => Promise<void>
    ) {}

    async open(initial?: OnboardingState): Promise<void> {
        this.closeVisual();
        this.state = initial ?? INITIAL_ONBOARDING_STATE;
        this.hero = await this.service.heroDataUrl();
        this.root = document.createElement('div');
        this.root.id = 'akari-onboarding-v1';
        this.root.setAttribute('data-akari-onboarding-step', this.state.step);
        this.root.addEventListener('click', event => void this.handleClick(event));
        this.root.addEventListener('dragstart', event => {
            if ((event.target as Element).closest('[data-ao-file]')) event.dataTransfer?.setData('application/x-akari-onboarding-sample', 'sample');
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
    }

    protected closeVisual(): void {
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers = [];
        if (this.exportPoll) window.clearInterval(this.exportPoll);
        if (this.placeFrame) cancelAnimationFrame(this.placeFrame);
        this.root?.remove();
        this.root = undefined;
        document.body.classList.remove('akari-onboarding-active');
        document.removeEventListener('click', this.handleExternalClick, true);
        document.removeEventListener('drop', this.handleDrop, true);
        document.removeEventListener('dragover', this.handleDragOver, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('input', this.handleInput, true);
        window.removeEventListener('akari.preview.playbackTick', this.handlePlayback as EventListener);
        window.removeEventListener('akari.preview.captionSelected', this.handleCaptionSelection as EventListener);
        if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
        this.videoUrl = undefined;
    }

    async close(): Promise<void> {
        await this.service.markSeen();
        this.closeVisual();
    }

    protected async go(step: OnboardingStep, sub = 0): Promise<void> {
        this.state = nextOnboardingState(this.state, step, sub);
        await this.service.save(this.state);
        this.render();
        if (step === 'prompt') this.startPromptTypewriter();
        if (step === 'work') void this.startWork();
        if ((step === 'play' || step === 'caption') && this.state.projectUri)
            await this.seekOutput(this.state.projectUri, step === 'caption' ? 8.7 : 0);
        if (step === 'export') this.beginExportPoll();
        if (step === 'done') await this.service.markSeen();
    }

    protected async setSub(sub: number): Promise<void> {
        this.state = { ...this.state, sub };
        await this.service.save(this.state);
        this.render();
    }

    protected takeover(): string {
        const hero = `<div class="ao-hero ${this.state.step === 'welcome' ? '' : 'small'}"><img src="${this.hero}" alt=""></div>`;
        const brand = '<div class="ao-brand">AKARI VIDEO</div>';
        if (this.state.step === 'welcome') return `${hero}${brand}<h2>AKARI Video へようこそ</h2><div class="ao-actions"><button class="primary" data-ao="next">次へ</button></div>`;
        if (this.state.step === 'first') return `${hero}${brand}<h2>AKARI Video を使うのは、はじめてですか？</h2><div class="ao-actions"><button class="primary" data-ao="yes">はじめて</button><button data-ao="no">使ったことがある</button></div>`;
        if (this.state.step === 'invite') return `${hero}${brand}<h2>一緒に 1 本、つくってみませんか？</h2><p>用意した動画に、AI でタイトルと字幕を入れて、書き出すところまで。5 分ほどです。途中でやめても大丈夫です。</p><div class="ao-chip">サンプル動画<small>0:37 · 話している人の動画 · 用意してあります</small></div>${this.busy ? '<p>準備しています… 作業場とプロジェクトを作っています</p>' : `${this.prepareError ? `<p role="alert">${esc(this.prepareError)}</p>` : ''}<div class="ao-actions"><button class="primary" data-ao="start">${this.prepareError ? 'もう一度' : 'やってみる'}</button><button data-ao="later">あとで（自分で始める）</button></div>`}`;
        const connect = partnerToConnect(this.state.answer);
        return `${hero}<h2>はじめての 1 本ができました</h2><div class="ao-donelist"><span>✓ 素材を入れた</span><span>✓ AI に頼んだ</span><span>✓ 字幕を直した</span><span>✓ 書き出した</span></div><div class="ao-later"><b>このあと必要になったら、その場で案内するもの</b><ul><li>自分の動画の文字起こし（Whisper のモデル 約 574MB）</li><li>AKARI Video Lab の素材（BGM・効果音・図解など）</li><li>ほかの道具（YouTube の取り込みなど）</li></ul></div>${connect ? '' : '<p>AI とつなぐのは、使いたくなったときで大丈夫です。右の「パートナーを追加」から、いつでもつなげます。</p>'}<div class="ao-actions">${connect ? `<button data-ao="connect">${connect} をつなぐ</button>` : ''}<button class="primary" data-ao="own">自分の動画で始める</button><button data-ao="explore">このまま触ってみる</button><button data-ao="again">もう一度見る</button></div>`;
    }

    protected coach(): CoachSpec | undefined {
        const sub = this.state.sub;
        switch (this.state.step) {
            case 'tour': return { title: '画面は大きく 3 つです', targets: ['assets', 'output', 'timeline', 'partner'],
                labels: ['① 素材', '② プレビュー ／ タイムライン', '', '③ AI パートナー'],
                body: '<p>① 左の「素材」に、使う動画や写真を入れます。</p><p>② 真ん中の上で仕上がりを見て、下のタイムラインで並びを確かめます。</p><p>③ 右の AI パートナーに、やりたいことを文章で頼みます。</p>',
                buttons: [['次へ', 'next', true]] };
            case 'drag': return { title: 'まず素材を入れます', targets: ['assets'], wide: true,
                body: `<p>用意した動画を、左の「素材」へドラッグしてください。</p><p class="ao-note">${navigator.platform.includes('Mac') ? 'Finder' : 'エクスプローラー'}の右側で、中身を再生して確かめられます。</p>`,
                link: ['import', 'ドラッグしづらいときは、ここを押して入れる'] };
            case 'matpreview': return sub === 0
                ? { title: '素材を押すと、中身が見られます', targets: ['sample-card'], body: '<p>入った動画を押してみてください。</p>' }
                : { title: 'ここは「素材プレビュー」です', targets: ['material-preview'], body: '<p>取り込んだ素材を、そのまま再生して確かめられます。確かめたら次へ。</p>', buttons: [['次へ', 'next', true]] };
            case 'ask': return sub === 0
                ? { title: '編集は、右の AI に頼みます', targets: ['partner'], wide: true,
                    body: '<p>やりたいことを文章で伝えると、AI がタイムラインを組み立てます。いま使っている AI はありますか？</p>',
                    choices: [['claude', 'Claude', 'Pro・Max'], ['chatgpt', 'ChatGPT', '無料のアカウントでも可'], ['google', 'Google', 'AI Pro・無料のアカウント'], ['none', 'どれも使っていない', ''], ['other', 'ほかの AI', 'Cursor・Copilot・Devin など']] }
                : { title: '今回は、お手本で流れを見ます', targets: [this.state.answer === 'claude' ? 'partner-claude' : this.state.answer === 'chatgpt' ? 'partner-codex' : this.state.answer === 'google' ? 'partner-antigravity' : 'partner'], wide: true,
                    body: `<p>${({ claude: 'Claude の Pro・Max なら、つなぐのは「Claude Code CLI」です（光っているところ）。', chatgpt: 'ChatGPT なら、つなぐのは「Codex CLI」です（光っているところ）。無料のアカウントでも使えます。', google: 'Google のアカウントなら、つなぐのは「Antigravity CLI」です（光っているところ）。', none: 'AI とつながなくても、流れはお手本で見られます。', other: 'お使いの AI は、あとでこの一覧からつなげます。' } as Record<AiAnswer, string>)[this.state.answer ?? 'none']}</p><p>このあとは AI を使わずに、頼んでから仕上がるまでをお手本で再生します。本物の AI とは、最後につなげます。</p>`,
                    buttons: [['お手本を始める', 'replay', true]], link: ['reanswer', '選び直す'] };
            case 'prompt': return sub === 0
                ? { title: 'AI には、こう頼みます', targets: ['replay-input'], wide: true,
                    body: `<p>${esc(this.promptTyped)}<span aria-hidden="true">▍</span></p><p class="ao-note">自分で打っても大丈夫です。</p>`,
                    buttons: [['コピー', 'copy', false], ['入力欄に入れる', 'insert', true]] }
                : { title: '「送る」を押してください', targets: ['replay-input'],
                    body: '<p>ここから先は、用意したお手本を再生します。AI は使いません。</p>', buttons: [['送る', 'send', true]] };
            case 'work': return { title: 'AI が編集しています', noDim: true, narrow: true,
                body: `<p>${esc(this.live)}</p><p>下のタイムラインと上のプレビューに、AI が置いたものが増えていきます。</p><p class="ao-note">試作は 12 秒に縮めています。実際には数分かかることがあります（未計測）。</p>`,
                buttons: this.workError ? [['もう一度', 'retry-work', true]] : undefined };
            case 'play': return sub === 0 ? { title: 'できました。再生してみましょう', targets: ['output'], body: '<p>▶ を押してください。</p>' }
                : { title: 'タイトルと字幕が入りました', targets: ['output'], body: '<p>止めるときは、もう一度 ▶ を押します。見終わったら次へ。</p>', buttons: [['次へ', 'next', true]] };
            case 'caption': return ([
                { title: '字幕を押すと、その場で直せます', targets: ['output'], body: '<p>プレビューの字幕を押してください。</p>' },
                { title: '大きさを変えてみましょう', targets: ['caption-size'], body: '<p>上に出たメニューの「大きさ」を押します。</p>' },
                { title: 'つまみを動かしてみてください', targets: ['caption-size-slider'], body: '<p>いまは全部の字幕が一緒に変わります。字幕の上の小さなボタンで「この字幕だけ」にも切り替えられます。</p>' },
                { title: '位置も動かせます', targets: ['output'], body: '<p>字幕をドラッグすると上下に動きます。文字を直すときはダブルクリック。</p>', buttons: [['次へ', 'next', true]] }
            ] as CoachSpec[])[Math.min(sub, 3)];
            case 'daihon': return sub === 0
                ? { title: '字幕の全文は「台本」で見られます', targets: ['daihon-button'], body: '<p>右端の、紙のアイコンを押してください。</p>' }
                : { title: '行を押すと、その場面へ飛びます', targets: ['daihon'], body: '<p>ダブルクリックで文字も直せます。</p><p>AI パートナーに戻るときは、右端のいちばん上の Claude のアイコンを押します。</p>', buttons: [['次へ', 'next', true]] };
            case 'export': return ([
                { title: '書き出しは、左のメニューから', targets: ['menu-button'], body: '<p>≡ を押してください。</p>' },
                { title: '「書き出し…」を押します', targets: ['export-button'], body: '<p>編集データ（edit.json）ができていると押せます。</p>' },
                { title: '標準のまま「書き出す」', targets: ['export-submit'], body: '<p>画質や保存先は、ここで変えられます。</p>' },
                { title: '書き出しています', targets: ['export-progress'], body: '<p>進み具合は右下に出ます。そのまま作業を続けても大丈夫です。</p>' },
                { title: '書き出せました', targets: ['export-result'], body: '<p>できたファイルは「できたもの」に並びます。</p><p>AI パートナーに「書き出して」と頼んでも書き出せます（中身を見せて、確認してから実行します）。</p>', buttons: [['次へ', 'next', true]] }
            ] as CoachSpec[])[Math.min(sub, 4)];
            default: return undefined;
        }
    }

    protected finder(): string {
        if (this.state.step !== 'drag') return '';
        const mac = navigator.platform.includes('Mac');
        return `<div class="ao-finder" data-akari-onboarding-target="finder"><div class="ao-f-title">${mac ? '● ● ●  AKARI サンプル' : '▣ AKARI サンプル ✕'}</div><div class="ao-f-toolbar">⊕ 新規作成   ✂   ⧉   ⇅ 並べ替え   ☰ 表示   …</div><div class="ao-f-address">← → ↑  ${mac ? 'Finder' : 'PC › ビデオ'} › AKARI サンプル</div><div class="ao-f-body"><div class="ao-f-side">ホーム<br>デスクトップ<br>ダウンロード<br>ドキュメント<br>ビデオ<br>AKARI サンプル</div><div><div class="ao-f-file" data-ao-file draggable="true"><b>▶</b>サンプル動画.mp4<br><small>ドラッグ</small></div></div><div class="ao-f-preview"><video ${this.videoUrl ? `src="${this.videoUrl}"` : ''} muted autoplay loop playsinline></video><b>サンプル動画.mp4</b><small>種類 MPEG-4 ムービー<br>長さ 00:37<br>サイズ 1280×720</small></div></div></div>`;
    }

    protected chat(): string {
        if (!['prompt', 'work', 'play', 'caption'].includes(this.state.step)) return '';
        return `<div class="ao-chat" data-akari-onboarding-target="replay-chat"><h3>お手本（AI なし）</h3><div class="ao-chat-log">${this.logLines.map(esc).join('\n')}</div><textarea class="ao-chat-input" data-akari-onboarding-target="replay-input" ${this.state.step === 'prompt' ? '' : 'readonly'}>${this.state.step === 'prompt' && this.state.sub ? esc(PROMPT) : ''}</textarea><button data-ao="send" ${this.state.step === 'prompt' && this.state.sub ? '' : 'disabled'}>送る</button></div>`;
    }

    protected render(): void {
        if (!this.root) return;
        const takeover = ['welcome', 'first', 'invite', 'done'].includes(this.state.step);
        const spec = this.coach();
        const actions = (spec?.buttons ?? []).map(([label, action, primary]) => `<button data-ao="${action}" class="${primary ? 'primary' : ''}">${label}</button>`).join('');
        const choices = spec?.choices?.map(([answer, label, note]) => `<button data-ao="answer" data-answer="${answer}">${label}${note ? `<small>${note}</small>` : ''}</button>`).join('') ?? '';
        this.root.setAttribute('data-akari-onboarding-step', this.state.step);
        this.root.innerHTML = `<style>${ONBOARDING_CSS}</style><div class="ao-dim"></div><div class="ao-holes"></div>`
            + (takeover ? `<div class="ao-takeover"><div class="ao-takeover-inner">${this.takeover()}</div></div>` : '')
            + this.finder() + this.chat()
            + (spec ? `<div class="ao-coach ${spec.wide ? 'wide' : ''} ${spec.narrow ? 'narrow' : ''}"><div class="ao-count">STEP ${ONBOARDING_STEPS.indexOf(this.state.step) + 1} / ${ONBOARDING_STEPS.length}</div><h3>${spec.title}</h3>${spec.body}${choices ? `<div class="ao-choices">${choices}</div>` : ''}${spec.link ? `<button class="ao-link" data-ao="${spec.link[0]}">${spec.link[1]}</button>` : ''}${actions ? `<div class="ao-actions">${actions}</div>` : ''}</div>` : '');
        this.lastRects = '';
        this.placeCoach();
        if (this.state.step === 'drag' && !this.videoUrl) void this.loadVideo();
    }

    protected async loadVideo(): Promise<void> {
        if (!this.sample || this.videoUrl) return;
        try {
            const content = await this.files.readFile(URI.fromFilePath(this.sample.sourcePath));
            this.videoUrl = URL.createObjectURL(new Blob([new Uint8Array(content.value.buffer)], { type: 'video/mp4' }));
            const video = this.root?.querySelector<HTMLVideoElement>('.ao-f-preview video');
            if (video) { video.src = this.videoUrl; void video.play().catch(() => undefined); }
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
        const holes = this.root.querySelector<HTMLElement>('.ao-holes');
        const coach = this.root.querySelector<HTMLElement>('.ao-coach');
        if (!spec || !dim || !holes || !coach) return;
        const rects = (spec.targets ?? []).map(name => document.querySelector<HTMLElement>(`[data-akari-onboarding-target="${name}"]`))
            .filter((element): element is HTMLElement => !!element && element !== this.root && !this.root?.contains(element))
            .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        const serial = JSON.stringify(rects.map(rect => [rect.x, rect.y, rect.width, rect.height]));
        if (serial === this.lastRects) return;
        this.lastRects = serial;
        if (spec.noDim) { dim.innerHTML = ''; holes.innerHTML = ''; }
        else {
            dim.innerHTML = `<svg width="100%" height="100%"><defs><mask id="akari-onboarding-mask"><rect width="100%" height="100%" fill="white"/>${rects.map(rect => `<rect x="${rect.x - 5}" y="${rect.y - 5}" width="${rect.width + 10}" height="${rect.height + 10}" rx="12" fill="black"/>`).join('')}</mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,.58)" mask="url(#akari-onboarding-mask)"/></svg>`;
            holes.innerHTML = rects.map((rect, index) => `<div class="ao-hole" style="left:${rect.x - 5}px;top:${rect.y - 5}px;width:${rect.width + 10}px;height:${rect.height + 10}px">${spec.labels?.[index] ? `<span class="ao-hole-label">${spec.labels[index]}</span>` : ''}</div>`).join('');
        }
        const a = rects[0];
        const width = coach.offsetWidth;
        const height = coach.offsetHeight;
        let x = a ? a.right + 18 : (innerWidth - width) / 2;
        let y = a ? a.top + Math.min(40, (a.height - height) / 2) : (innerHeight - height) / 2;
        if (x + width > innerWidth - 15 && a) x = a.left - width - 18;
        if (this.state.step === 'tour') { x = Math.min(innerWidth - width - 20, Math.max(20, innerWidth * .39)); y = innerHeight - height - 22; }
        if (this.state.step === 'work') { x = 20; y = innerHeight * .52; }
        coach.style.left = `${Math.max(10, Math.min(x, innerWidth - width - 10))}px`;
        coach.style.top = `${Math.max(10, Math.min(y, innerHeight - height - 10))}px`;
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
        if (action === 'next') {
            const order = ONBOARDING_STEPS.indexOf(this.state.step);
            if (this.state.step === 'matpreview' && this.state.sub === 0) return this.nudge();
            if (this.state.step === 'play' && this.state.sub === 0) return this.nudge();
            if (this.state.step === 'caption' && this.state.sub < 3) return this.nudge();
            if (this.state.step === 'daihon' && this.state.sub === 0) return this.nudge();
            if (this.state.step === 'export' && this.state.sub < 4) return this.nudge();
            if (order >= 0 && order < ONBOARDING_STEPS.length - 1) await this.go(ONBOARDING_STEPS[order + 1]);
        } else if (action === 'yes') await this.go('invite');
        else if (action === 'no' || action === 'later') { await this.service.returnToHome(); this.closeVisual(); }
        else if (action === 'start') await this.prepare();
        else if (action === 'import') await this.importSample();
        else if (action === 'answer') {
            const answer = element.dataset.answer as AiAnswer;
            this.state = { ...this.state, answer };
            await this.setSub(1);
        } else if (action === 'reanswer') await this.setSub(0);
        else if (action === 'replay') await this.go('prompt');
        else if (action === 'copy') void navigator.clipboard.writeText(PROMPT);
        else if (action === 'insert') await this.setSub(1);
        else if (action === 'send' && this.state.step === 'prompt' && this.state.sub > 0) await this.go('work');
        else if (action === 'retry-work' && this.state.step === 'work') void this.startWork();
        else if (action === 'connect') { this.closeVisual(); await this.showPartner(); this.highlightPartner(); }
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
            this.state = { ...this.state, projectUri: prepared.projectUri, samplePath: prepared.sample.sourcePath };
            await this.go('tour');
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
            const paragraph = this.root.querySelector<HTMLElement>('.ao-coach p');
            if (paragraph) paragraph.innerHTML = `${esc(this.promptTyped)}<span aria-hidden="true">▍</span>`;
            if (index < characters.length) this.timers.push(window.setTimeout(tick, 35));
        };
        this.timers.push(window.setTimeout(tick, 80));
    }

    protected async importSample(): Promise<void> {
        if (!this.state.projectUri || !this.sample || this.busy) return;
        this.busy = true;
        try {
            await this.service.importSample(this.state.projectUri, this.sample.sourcePath);
            this.state = { ...this.state, imported: true };
            await this.go('matpreview');
        } catch (error) { this.live = error instanceof Error ? error.message : String(error); this.nudge(); }
        finally { this.busy = false; }
    }

    protected handleExternalClick = (event: MouseEvent): void => {
        if (!this.root || this.root.contains(event.target as Node)) return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-akari-onboarding-target]') : null;
        const name = target?.dataset.akariOnboardingTarget;
        if (this.state.step === 'matpreview' && name === 'sample-card' && this.state.sub === 0) void this.setSub(1);
        else if (this.state.step === 'caption' && name === 'caption-size' && this.state.sub === 1) void this.setSub(2);
        else if (this.state.step === 'daihon' && name === 'daihon-button' && this.state.sub === 0) void this.setSub(1);
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
    };

    protected handleInput = (event: Event): void => {
        if (this.state.step === 'caption' && this.state.sub === 2 && event.target instanceof Element
            && event.target.matches('[data-akari-onboarding-target="caption-size-slider"]')) void this.setSub(3);
    };

    protected handlePlayback = (event: CustomEvent<{ playing?: boolean }>): void => {
        if (this.state.step === 'play' && this.state.sub === 0 && event.detail?.playing) void this.setSub(1);
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
        try {
            for (const entry of LOG) {
                await new Promise<void>(resolve => {
                    this.timers.push(window.setTimeout(resolve, Math.max(0, entry.t - (performance.now() - started))));
                });
                if (!this.root || this.state.step !== 'work') return;
                this.live = entry.live ?? this.live;
                if (entry.count === 0) await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, 0, false);
                if (entry.t === 4500) {
                    for (let count = 1; count <= 7; count++) {
                        await new Promise<void>(resolve => { this.timers.push(window.setTimeout(resolve, 300)); });
                        if (!this.root || this.state.step !== 'work') return;
                        await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, count, false);
                        this.live = `字幕を置いています…（${count}/7）`;
                        this.render();
                        const segment = this.sample.segments[count - 1];
                        await this.seekOutput(this.state.projectUri, (segment.start + segment.end) / 2).catch(() => undefined);
                    }
                }
                if (entry.title) {
                    await this.service.writeExample(this.state.projectUri, this.sample.sourcePath, this.sample.segments, 7, true);
                    await this.seekOutput(this.state.projectUri, 8.6).catch(() => undefined);
                }
                if (entry.t === 10200) {
                    const errors = await this.service.lintExample(this.state.projectUri);
                    if (errors !== 0) throw new Error(`edit-lint: ${errors} 件の指摘`);
                }
                this.logLines.push(...entry.lines);
                this.render();
            }
            await new Promise<void>(resolve => { this.timers.push(window.setTimeout(resolve, 1500)); });
            if (this.root && this.state.step === 'work') await this.go('play');
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
            if (this.state.step !== 'export' || this.state.sub < 3 || !this.state.projectUri) return;
            void this.service.hasExport(this.state.projectUri).then(found => { if (found && this.state.sub !== 4) void this.setSub(4); });
        }, 1000);
    }

    protected highlightPartner(): void {
        const key = this.state.answer === 'claude' ? 'partner-claude' : this.state.answer === 'chatgpt' ? 'partner-codex' : 'partner-antigravity';
        const row = document.querySelector<HTMLElement>(`[data-akari-onboarding-target="${key}"]`);
        if (!row) return;
        row.style.outline = '3px solid #ffa249';
        row.style.boxShadow = '0 0 24px #ff8a38';
        window.setTimeout(() => { row.style.removeProperty('outline'); row.style.removeProperty('box-shadow'); }, 6000);
    }
}
