/**
 * プロジェクトカードのサムネ再生。ランチャー（素の DOM ダイアログ）とホーム／ウェルカム
 * （React ウィジェット）の 3 面が同じ挙動を共有するため、ここ 1 箇所だけに実装を置く。
 * React 側は「中身を React に描かせない span」を 1 個だけ用意して ref でこの制御へ渡す
 * （imperative なウィジェットを React の外で持たせる定番の形）。
 */

/** ホバー中にコマを送る間隔（ms）。5 コマなら 1 周およそ 3 秒。 */
export const PROJECT_CARD_CYCLE_INTERVAL_MS = 650;

/**
 * カードの角丸。3 面（ランチャー・ホーム・ウェルカム）で同じ値を使う。
 *
 * Theia の `.theia-button` は `border-radius: 2px` を当ててくるが `!important` ではないので、
 * インラインスタイルで素直に勝てる（別途 CSS を被せる必要はない）。角丸が見えるかどうかは
 * 単に値の問題で、10px では 240px 幅のカードに対して弱く「角が落ちている」程度にしか読めない。
 */
export const PROJECT_CARD_RADIUS_PX = 14;

/**
 * カード 1 枚ぶんのサムネ再生。ポスターを敷き、ホバー／フォーカスのあいだだけ
 * 残りのコマへ順に切り替えてループする（サムネというより「軽い動きのプレビュー」）。
 *
 * - 2 枚目以降は最初にホバーされるまで DOM に載せない（開いた瞬間の一斉読み込みを避ける）
 * - コマは重ねて置いて opacity で入れ替える（`src` の差し替えだと初回に一瞬白く抜ける）
 * - OS のアニメーション低減設定が入っていればループしない（ポスターのまま）
 */
export class ProjectCardPreview {

    protected frames: string[] = [];
    protected readonly images: HTMLImageElement[] = [];
    protected readonly segments: HTMLElement[] = [];
    protected indicator: HTMLElement | undefined;
    protected timer: ReturnType<typeof setInterval> | undefined;
    protected activeIndex = 0;
    protected hydrated = false;
    protected disposed = false;

    /**
     * @param container コマを敷く枠（16:9 の `position: relative` な要素。中身はこの制御が所有する）
     * @param hoverTarget ホバー／フォーカスを受ける要素。カード全体を渡す — 中の「開く」ボタンが
     *   `disabled`（いま開いているプロジェクト）でもカードの上では再生が効くように、
     *   ボタンではなく外側のカードを渡すこと
     */
    constructor(
        protected readonly container: HTMLElement,
        protected readonly card: HTMLElement
    ) {
        this.card.addEventListener('mouseenter', this.start);
        this.card.addEventListener('mouseleave', this.stop);
        this.card.addEventListener('focus', this.start);
        this.card.addEventListener('blur', this.stop);
    }

    /** 解決したコマを受け取ってポスターを敷く。空配列ならプレースホルダのまま。 */
    adopt(frames: string[]): void {
        if (this.disposed || frames.length === 0) {
            return;
        }
        this.frames = frames;
        this.appendImage(frames[0], true);
    }

    protected start = (): void => {
        if (this.disposed || this.frames.length < 2 || this.timer || this.prefersReducedMotion()) {
            return;
        }
        if (!this.hydrated) {
            this.hydrated = true;
            for (const frame of this.frames.slice(1)) {
                this.appendImage(frame, false);
            }
            this.buildIndicator();
        }
        if (this.indicator) {
            this.indicator.style.opacity = '1';
        }
        this.timer = setInterval(this.advance, PROJECT_CARD_CYCLE_INTERVAL_MS);
    };

    protected stop = (): void => {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.indicator) {
            this.indicator.style.opacity = '0';
        }
        this.show(0);
    };

    protected advance = (): void => {
        this.show((this.activeIndex + 1) % this.images.length);
    };

    protected show(index: number): void {
        this.activeIndex = index;
        this.images.forEach((image, position) => {
            image.style.opacity = position === index ? '1' : '0';
        });
        this.segments.forEach((segment, position) => {
            segment.style.opacity = position === index ? '0.95' : '0.35';
        });
    }

    /**
     * いま何コマ目かの目盛り。ループ中だけ出す — 絵の動きが小さい動画でも
     * 「送っている」ことが伝わるように（写真が差し替わっただけに見せない）。
     */
    protected buildIndicator(): void {
        const indicator = document.createElement('span');
        Object.assign(indicator.style, {
            position: 'absolute', left: '7px', right: '7px', bottom: '6px',
            display: 'flex', gap: '3px', opacity: '0', transition: 'opacity 180ms ease',
            pointerEvents: 'none'
        });
        for (let index = 0; index < this.images.length; index += 1) {
            const segment = document.createElement('span');
            Object.assign(segment.style, {
                flex: '1 1 0', height: '2px', borderRadius: '1px',
                background: 'rgba(255, 255, 255, 0.92)',
                boxShadow: '0 0 2px rgba(0, 0, 0, 0.55)',
                opacity: index === this.activeIndex ? '0.95' : '0.35',
                transition: 'opacity 180ms ease'
            });
            indicator.appendChild(segment);
            this.segments.push(segment);
        }
        this.container.appendChild(indicator);
        this.indicator = indicator;
    }

    protected appendImage(source: string, visible: boolean): void {
        const image = document.createElement('img');
        image.src = source;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        Object.assign(image.style, {
            position: 'absolute', inset: '0', width: '100%', height: '100%',
            objectFit: 'cover', opacity: visible ? '1' : '0', transition: 'opacity 180ms ease'
        });
        // 元動画が消えている等でコマだけ読めなかったら、そのカードは黙ってプレースホルダへ戻す。
        image.addEventListener('error', () => image.remove(), { once: true });
        this.container.appendChild(image);
        this.images.push(image);
    }

    protected prefersReducedMotion(): boolean {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this.card.removeEventListener('mouseenter', this.start);
        this.card.removeEventListener('mouseleave', this.stop);
        this.card.removeEventListener('focus', this.start);
        this.card.removeEventListener('blur', this.stop);
    }
}
