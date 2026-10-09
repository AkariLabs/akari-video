import type { InspectorWriteRequest, InspectorWriteResult, TimelineCaptionSelection } from '../timeline-selection-model';
import { PREVIEW_CAPTION_ANIMATION_RECIPES, PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS } from 'akari-preview/lib/common/caption-text-animation-recipes';
import { CAPTION_MOTION_COMBOS, captionMotionComboWrites, captionMotionComboClear, captionMotionCards, presetToAnimation,
    captionTextAnimationCards, captionTextAnimationWrite, captionTextAnimationNext, captionTextAnimationClear,
    captionMotionOriginalAnimation } from './caption-motion-cards';
import type { CaptionAnimation } from '../../common/caption-store';
import { CAPTION_TEXT_ANIMATIONS } from './caption-motion-catalog';
import type { InspectorMotionSlot } from './motion-fields';
import { CAPTION_WORD_STYLES, CAPTION_EMPHASIS_STYLES,
    type CaptionMotionCue, type CaptionKaraokeSettings } from './caption-motion-document';

export interface CaptionMotionServices {
    loadCue(): Promise<CaptionMotionCue>;
    loadCues?(): Promise<CaptionMotionCue[]>;
    setWordStyle(style: string | null): Promise<InspectorWriteResult>;
    setKaraoke(settings: CaptionKaraokeSettings, selectStyle?: boolean): Promise<InspectorWriteResult>;
    setEmphasis(wordIndex: number, style: typeof CAPTION_EMPHASIS_STYLES[number]['id']): Promise<InspectorWriteResult>;
    readOwner?(): Promise<{ id: string; motion?: Record<string, unknown>; durationFrames: number }>;
}

const slots: readonly InspectorMotionSlot[] = ['in', 'loop', 'out'];
const oneShotLoopIds = new Set<string>(PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS);
const labels = { in: '登場', loop: '強調', out: '退場' } as const;
const views = new Map<string, { slot: InspectorMotionSlot; all: boolean }>();
let observer: IntersectionObserver | undefined;

export const CAPTION_MOTION_PANEL_CSS = `
.akari-caption-motion-panel{display:grid;gap:10px;min-width:0}
.akari-caption-motion-title{font-size:11px;font-weight:700;color:var(--akari-muted);margin-top:5px}
.akari-caption-motion-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.akari-inspector-widget button.akari-caption-motion-card{min-width:0;border:1px solid var(--akari-line);border-radius:6px;background:var(--akari-card);color:var(--akari-ink);padding:3px;font:inherit;cursor:pointer}
.akari-inspector-widget button.akari-caption-motion-card[aria-pressed="true"]{border-color:var(--akari-accent)}
.akari-inspector-widget button.akari-caption-motion-card:disabled:hover{background:var(--akari-card)}
.akari-inspector-widget .akari-caption-motion-sample-frame{display:flex;align-items:center;justify-content:center;height:34px;overflow:hidden;background:repeating-conic-gradient(#b8b8b8 0% 25%,#d5d5d5 0% 50%) 50% / 16px 16px}
.akari-inspector-widget .akari-caption-motion-sample{display:flex;align-items:center;justify-content:center;min-height:34px;color:#1f2937;font-size:16px;font-weight:700}
.akari-inspector-widget .akari-caption-motion-card>span:last-child{display:block;padding:3px 0;font-size:10px;line-height:1.25}
.akari-caption-motion-switch{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.akari-inspector-widget .akari-caption-motion-switch button,.akari-inspector-widget button.akari-caption-motion-more{border:1px solid var(--akari-line);border-radius:5px;background:var(--akari-elevated);color:var(--akari-ink);padding:5px;cursor:pointer}
.akari-inspector-widget .akari-caption-motion-switch button[aria-pressed="true"]{border-color:var(--akari-accent)}
.akari-caption-motion-words{display:flex;flex-wrap:wrap;gap:4px}
.akari-inspector-widget .akari-caption-motion-words button{border:1px solid var(--theia-input-border,var(--akari-line));border-radius:999px;background:var(--theia-input-background,var(--akari-elevated));color:var(--theia-input-foreground,var(--akari-ink));padding:3px 9px;cursor:pointer}
.akari-inspector-widget .akari-caption-motion-words button[aria-pressed="true"]{border-color:var(--theia-focusBorder,var(--akari-accent));background:var(--theia-button-background,var(--akari-accent));color:var(--theia-button-foreground,#fff)}
.akari-inspector-widget .akari-caption-motion-words button:focus-visible{outline:2px solid var(--theia-focusBorder,var(--akari-accent));outline-offset:2px}
.akari-inspector-widget .akari-caption-motion-words button.akari-caption-motion-swatch{box-sizing:border-box;width:22px;height:22px;min-width:22px;flex:0 0 22px;padding:0;border-radius:5px}
.akari-inspector-widget .akari-caption-motion-words button.akari-caption-motion-swatch[aria-pressed="true"]{outline:2px solid var(--akari-accent);outline-offset:2px}
.akari-caption-motion-note{font-size:11px;color:var(--akari-muted)}
@keyframes akari-motion-karaoke{0%,20%,70%,100%{color:var(--akari-motion-karaoke-color,#ffd94a)}20.1%{color:#1f2937}}
@keyframes akari-motion-caret{0%,49%{border-color:currentColor}50%,100%{border-color:transparent}}
@keyframes akari-motion-type{0%,20%,70%,100%{max-width:3em}20.1%{max-width:0}}
`;

/** Leave the glyph visible at both ends of every sample cycle. */
export function captionMotionSampleKeyframes(recipe: string): string {
    const hold = 'opacity:1;transform:none;clip-path:inset(0)';
    const frames = [...recipe.matchAll(/([^{}]+)\{([^{}]+)\}/g)].flatMap(([, selectors, body]) =>
        selectors.split(',').map(selector => {
            const key = selector.trim();
            const percent = key === 'from' ? 0 : key === 'to' ? 100 : Number.parseFloat(key);
            return Number.isFinite(percent) ? `${(20.1 + percent * .499).toFixed(2)}%{${body}}` : '';
        })).filter(Boolean);
    return `0%,20%{${hold}}${frames.join('')}70%,100%{${hold}}`;
}

const SAMPLE_CSS = Object.entries(PREVIEW_CAPTION_ANIMATION_RECIPES).map(([id, frames]) =>
    `@keyframes akari-motion-sample-${id}{${captionMotionSampleKeyframes(frames)}}`).join('\n');

export function createCaptionMotionPanel(snapshot: TimelineCaptionSelection,
    write: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    services?: CaptionMotionServices): HTMLElement {
    observer?.disconnect();
    const document = globalThis.document;
    const root = document.createElement('div');
    root.className = 'akari-caption-motion-panel';
    const notice = document.createElement('div');
    notice.setAttribute('role', 'alert');
    const css = document.createElement('style');
    css.textContent = CAPTION_MOTION_PANEL_CSS + SAMPLE_CSS;
    root.appendChild(css);
    const state = views.get(snapshot.id) ?? { slot: 'in' as InspectorMotionSlot, all: false };
    views.set(snapshot.id, state);
    let animation = snapshot.textStyle?.animation;
    let currentSnapshot = snapshot;
    let karaokeColor = '#ffd94a';
    const active = animation?.[state.slot]?.id;
    if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const sample = (entry.target as HTMLElement).querySelector<HTMLElement>('.akari-caption-motion-sample');
                if (sample) sample.style.animationPlayState = entry.isIntersecting ? 'running' : 'paused';
            }
        }, { threshold: .05 });
    }
    const heading = (label: string, parent: HTMLElement = root): void => {
        const title = document.createElement('div');
        title.className = 'akari-caption-motion-title';
        title.textContent = label;
        parent.appendChild(title);
    };
    const play = (id: string, kind?: string, wordIndex?: number, slot?: InspectorMotionSlot): void => {
        window.dispatchEvent(new CustomEvent('akari-caption-motion-play',
            { detail: { captionId: snapshot.id, id, kind, wordIndex, slot } }));
    };
    const commit = (request: InspectorWriteRequest, next: CaptionAnimation | undefined,
        id?: string, slot?: InspectorMotionSlot): void => {
        void write(request).then(result => {
            if (result.ok) {
                animation = next;
                currentSnapshot = { ...currentSnapshot,
                    textStyle: { ...currentSnapshot.textStyle, animation: next } };
                syncPressed();
                if (id) play(id, undefined, undefined, slot);
            } else {
                notice.textContent = result.message ?? '動きを書き込めませんでした。';
            }
        });
    };
    let sampleIndex = 0;
    const grid = (items: readonly { id: string; label: string; animation: string;
        kind: 'combo' | 'slot' | 'textanim' | 'word-style' | 'emphasis'; slot?: InspectorMotionSlot;
        selected?: boolean;
        disabled?: boolean; onClick: (selected: boolean) => void }[], parent: HTMLElement = root): void => {
        const container = document.createElement('div');
        container.className = 'akari-caption-motion-grid';
        for (const item of items) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'akari-caption-motion-card';
            card.dataset.motionId = item.id;
            card.dataset.motionKind = item.kind;
            card.dataset.motionAnimation = item.animation;
            if (item.slot) card.dataset.motionSlot = item.slot;
            card.setAttribute('aria-pressed', String(!!item.selected));
            card.disabled = item.disabled === true;
            const sample = document.createElement('span');
            sample.className = 'akari-caption-motion-sample';
            sample.textContent = 'あいう';
            const sampleFrame = document.createElement('span');
            sampleFrame.className = 'akari-caption-motion-sample-frame';
            sampleFrame.appendChild(sample);
            if (item.id === 'danger') sample.style.color = '#f87171';
            if (item.id === 'positive') sample.style.color = '#4ade80';
            if (item.id === 'color-only' || item.id === 'color-accent' || item.id === 'highlight') {
                sample.style.color = '#ffd94a';
            }
            if (item.id === 'outline-bold') {
                sample.style.webkitTextStroke = '2px var(--akari-bg)';
                sample.style.paintOrder = 'stroke fill';
            }
            if (item.animation === 'typewriter') {
                sample.style.display = 'block';
                sample.style.width = 'max-content';
                sample.style.margin = '0 auto';
                sample.style.whiteSpace = 'nowrap';
                sample.style.overflow = 'hidden';
                sample.style.borderRight = '2px solid currentColor';
                sample.style.animation = 'akari-motion-type 1.4s steps(3,end) infinite, akari-motion-caret .6s step-end infinite';
            } else if (item.animation === 'karaoke') {
                sample.style.setProperty('--akari-motion-karaoke-color', karaokeColor);
                sample.style.animation = 'akari-motion-karaoke 1.4s steps(3,end) infinite';
            } else {
                const direction = item.slot === 'out' ? 'reverse'
                    : item.slot === 'loop' && !oneShotLoopIds.has(item.animation) ? 'alternate' : 'normal';
                sample.style.animation = `akari-motion-sample-${item.animation} 1.4s ease-in-out infinite ${direction}`;
            }
            if (item.disabled) sample.style.animation = 'none';
            sample.style.animationPlayState = observer ? 'paused' : 'running';
            sample.style.animationDelay = `${(-(sampleIndex++ % 8) * .17).toFixed(2)}s`;
            const caption = document.createElement('span');
            caption.textContent = item.label;
            card.append(sampleFrame, caption);
            card.addEventListener('click', () => item.onClick(card.getAttribute('aria-pressed') === 'true'));
            container.appendChild(card);
            observer?.observe(card);
        }
        parent.appendChild(container);
    };
    const syncPressed = (): void => {
        root.querySelectorAll<HTMLButtonElement>('.akari-caption-motion-card').forEach(card => {
            const kind = card.dataset.motionKind;
            if (kind === 'combo') {
                const combo = CAPTION_MOTION_COMBOS.find(item => item.id === card.dataset.motionId);
                if (!combo) return;
                card.setAttribute('aria-pressed', String(
                    animation?.in?.id === (combo.id === 'typewriter' ? 'typewriter' : presetToAnimation[combo.in])
                    && animation?.out?.id === presetToAnimation[combo.out]
                    && animation?.loop?.id === ('loop' in combo && combo.loop
                        ? presetToAnimation[combo.loop] : undefined)));
            } else if (kind === 'slot' || kind === 'textanim') {
                card.setAttribute('aria-pressed', String(card.dataset.motionSlot === state.slot
                    && animation?.[state.slot]?.id === card.dataset.motionAnimation));
            }
        });
    };
    if (snapshot.effectiveTextStyle?.animation && !snapshot.textStyle?.animation) {
        const note = document.createElement('div');
        note.className = 'akari-caption-motion-note';
        note.textContent = '全体の動きが当たっています';
        root.appendChild(note);
    }
    heading('まとめて当てる組');
    grid(CAPTION_MOTION_COMBOS.map(combo => ({
        id: combo.id, kind: 'combo' as const, label: combo.label, animation: combo.id === 'typewriter' ? 'typewriter'
            : presetToAnimation[combo.in],
        selected: animation?.in?.id === (combo.id === 'typewriter' ? 'typewriter' : presetToAnimation[combo.in])
            && animation?.out?.id === presetToAnimation[combo.out]
            && animation?.loop?.id === ('loop' in combo && combo.loop ? presetToAnimation[combo.loop] : undefined),
        onClick: selected => {
            if (selected) {
                commit(captionMotionComboClear(snapshot.id), undefined);
                return;
            }
            const id = combo.id === 'typewriter' ? 'typewriter' : presetToAnimation[combo.in];
            const [request] = captionMotionComboWrites(snapshot.id, combo.id);
            const raw = (request as unknown as { value: { parts: { animation: Record<string, unknown> }[] } })
                .value.parts[0].animation;
            const next = captionMotionOriginalAnimation(JSON.stringify([{ id: snapshot.id,
                text_style: { animation: raw } }]), snapshot.id) ?? undefined;
            commit(request, next, id);
        }
    })));
    heading('動き');
    const switcher = document.createElement('div');
    switcher.className = 'akari-caption-motion-switch';
    for (const slot of slots) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = labels[slot];
        button.setAttribute('aria-pressed', String(state.slot === slot));
        button.addEventListener('click', () => { state.slot = slot; root.replaceWith(createCaptionMotionPanel(currentSnapshot, write, services)); });
        switcher.appendChild(button);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'なし';
    clear.addEventListener('click', () => {
        const slot = state.slot;
        const next = { ...animation };
        delete next[slot];
        commit(captionTextAnimationClear(snapshot.id, slot), next);
    });
    switcher.appendChild(clear);
    root.appendChild(switcher);
    grid(captionMotionCards(state.slot).map(card => ({
        ...card, kind: 'slot' as const, slot: state.slot, animation: presetToAnimation[card.id],
        selected: active === presetToAnimation[card.id],
        onClick: selected => {
            if (selected) {
                const next = { ...animation };
                delete next[state.slot];
                commit(captionTextAnimationClear(snapshot.id, state.slot), next);
                return;
            }
            const next = captionTextAnimationNext(animation, state.slot, presetToAnimation[card.id]);
            commit(captionTextAnimationWrite(snapshot.id, animation, state.slot,
                presetToAnimation[card.id]), next, presetToAnimation[card.id], state.slot);
        }
    })));
    heading('テキストアニメ');
    grid(captionTextAnimationCards(state.all).map(card => ({
        id: card.id, kind: 'textanim' as const, label: card.label, animation: card.id, slot: state.slot,
        selected: animation?.[state.slot]?.id === card.id,
        onClick: selected => {
            if (selected) {
                const next = { ...animation };
                delete next[state.slot];
                commit(captionTextAnimationClear(snapshot.id, state.slot), next);
            } else {
                const next = captionTextAnimationNext(animation, state.slot, card.id);
                commit(captionTextAnimationWrite(snapshot.id, animation, state.slot, card.id),
                    next, card.id, state.slot);
            }
        }
    })));
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'akari-caption-motion-more';
    more.textContent = state.all ? '代表だけ見る' : `もっと見る（全 ${CAPTION_TEXT_ANIMATIONS.length} 種）`;
    more.addEventListener('click', () => { state.all = !state.all; root.replaceWith(createCaptionMotionPanel(currentSnapshot, write, services)); });
    root.appendChild(more);
    const wordSection = document.createElement('div');
    const emphasisSection = document.createElement('div');
    root.append(wordSection, emphasisSection);
    if (services) void (services.loadCues ? services.loadCues() : services.loadCue().then(cue => [cue])).then(cues => {
        if (!root.isConnected) return;
        const cue = cues.find(item => item.words.length) ?? cues[0];
        if (!cue) return;
        const hasTimedWords = cues.some(item => item.words.length > 0);
        const multipleCues = cues.length > 1;
        let selected = 0;
        let wordStyle = cues.filter(item => item.words.length).every(item => item.style === cue.style)
            ? cue.style : undefined;
        let karaoke = cue.text_style?.karaoke;
        karaokeColor = karaoke?.done_color ?? '#ffd94a';
        const repaintWords = (): void => {
            wordSection.querySelectorAll<HTMLElement>('[data-motion-id]').forEach(card => observer?.unobserve(card));
            wordSection.replaceChildren();
            heading('語ごとの表示', wordSection);
            if (!hasTimedWords) {
                const reason = document.createElement('div');
                reason.className = 'akari-caption-motion-note';
                reason.textContent = '語の時刻がない字幕では、カラオケ・ポップ・1 語ずつは動きません';
                wordSection.appendChild(reason);
            }
            grid(CAPTION_WORD_STYLES.map(item => ({ ...item,
                kind: 'word-style' as const,
                animation: item.id === 'karaoke' ? 'karaoke' : item.id === 'pop' ? 'pop' : 'fade-up',
                selected: wordStyle === item.id,
                disabled: !hasTimedWords && (item.id === 'karaoke' || item.id === 'pop' || item.id === 'reveal-word'),
                onClick: () => { const newlySelected = item.id === 'karaoke' && wordStyle !== 'karaoke';
                    void (newlySelected
                    ? services.setKaraoke({ done_color: '#fb923c', fill: 'char' }, true)
                    : services.setWordStyle(item.id)).then(result => {
                    if (!result.ok) { notice.textContent = result.message ?? '語の表示を書き込めませんでした。'; return; }
                    notice.textContent = result.message ?? '';
                    wordStyle = item.id;
                    if (newlySelected) karaoke = { ...karaoke, done_color: '#fb923c', fill: 'char' };
                    karaokeColor = karaoke?.done_color ?? '#ffd94a';
                    repaintWords();
                    play(item.id, 'word-style');
                }); }
            })), wordSection);
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'akari-caption-motion-more';
            clear.textContent = '語ごとの表示を外す';
            clear.addEventListener('click', () => { void services.setWordStyle(null).then(result => {
                if (!result.ok) { notice.textContent = result.message ?? '語の表示を外せませんでした。'; return; }
                wordStyle = undefined;
                repaintWords();
            }); });
            wordSection.appendChild(clear);
            if (wordStyle === 'karaoke' && hasTimedWords) {
                heading('カラオケの設定', wordSection);
                const save = (patch: CaptionKaraokeSettings): void => {
                    void services.setKaraoke(patch).then(result => {
                        if (!result.ok) { notice.textContent = result.message ?? 'カラオケの設定を書き込めませんでした。'; return; }
                        notice.textContent = result.message ?? '';
                        karaoke = { ...karaoke, ...patch };
                        karaokeColor = karaoke.done_color ?? '#ffd94a';
                        repaintWords();
                        play('karaoke', 'word-style');
                    });
                };
                const doneLabel = document.createElement('label');
                doneLabel.textContent = '歌い終わった文字の色';
                const colors = document.createElement('div');
                colors.className = 'akari-caption-motion-words';
                for (const color of ['#fb923c', '#ffd94a', '#f87171', '#4ade80', '#60a5fa']) {
                    const swatch = document.createElement('button');
                    swatch.type = 'button';
                    swatch.className = 'akari-caption-motion-swatch';
                    swatch.title = color;
                    swatch.setAttribute('aria-label', color);
                    swatch.setAttribute('aria-pressed', String(color === karaokeColor));
                    swatch.style.background = color;
                    swatch.addEventListener('click', () => save({ done_color: color }));
                    colors.appendChild(swatch);
                }
                const custom = document.createElement('input');
                custom.type = 'color';
                custom.setAttribute('aria-label', '任意の色');
                custom.value = /^#[0-9a-f]{6}$/iu.test(karaokeColor) ? karaokeColor : '#ffd94a';
                custom.addEventListener('change', () => save({ done_color: custom.value }));
                colors.appendChild(custom);
                doneLabel.appendChild(colors);
                wordSection.appendChild(doneLabel);
                const label = document.createElement('label');
                label.textContent = 'まだの文字の色';
                const input = document.createElement('input');
                input.type = 'color';
                const pendingColor = cue.text_style?.color ?? snapshot.effectiveTextStyle?.color ?? '#ffffff';
                input.value = /^#[0-9a-f]{6}$/iu.test(pendingColor) ? pendingColor : '#ffffff';
                input.addEventListener('change', () => {
                    void write({ kind: 'caption-style-color', id: snapshot.id, value: input.value }).then(result => {
                        if (result.ok) play('karaoke', 'word-style');
                        else notice.textContent = result.message ?? '文字の色を書き込めませんでした。';
                    });
                });
                label.appendChild(input);
                wordSection.appendChild(label);
                heading('塗りの進み方', wordSection);
                const fills = document.createElement('div');
                fills.className = 'akari-caption-motion-words';
                for (const [fill, title] of [['char', '1 文字ずつ'], ['word', '1 語ずつ'], ['smooth', 'なめらか']] as const) {
                    const button = document.createElement('button');
                    button.type = 'button'; button.textContent = title;
                    button.setAttribute('aria-pressed', String(karaoke?.fill === fill));
                    button.addEventListener('click', () => save({ fill }));
                    fills.appendChild(button);
                }
                wordSection.appendChild(fills);
                if (!karaoke?.fill) {
                    const current = document.createElement('div');
                    current.className = 'akari-caption-motion-note';
                    current.textContent = '現在: 語ごとに色がじわっと変わります。';
                    wordSection.appendChild(current);
                }
                heading('開始位置', wordSection);
                const GraphemeSegmenter = (Intl as unknown as {
                    Segmenter: new (locale: undefined, options: { granularity: 'grapheme' }) => {
                        segment(value: string): Iterable<{ segment: string }>;
                    };
                }).Segmenter;
                const characters = Array.from(new GraphemeSegmenter(undefined, { granularity: 'grapheme' })
                    .segment(cue.text || cue.words.map(word => word.text).join('')), part => part.segment);
                const startChips = document.createElement('div');
                startChips.className = 'akari-caption-motion-words';
                characters.forEach((character, index) => {
                    const chip = document.createElement('button');
                    chip.type = 'button'; chip.textContent = character;
                    chip.setAttribute('aria-label', `開始位置 ${index + 1}: ${character}`);
                    chip.setAttribute('aria-pressed', String(index === (karaoke?.start_index ?? 0)));
                    chip.addEventListener('click', () => save({ start_index: index }));
                    startChips.appendChild(chip);
                });
                wordSection.appendChild(startChips);
            }
        };
        repaintWords();
        heading('強調（対象語）', emphasisSection);
        if (!cue.words.length || cue.time_domain === 'output' || multipleCues) {
            const reason = document.createElement('div');
            reason.className = 'akari-caption-motion-note';
            reason.textContent = multipleCues ? '強調する語は字幕を 1 行選んで設定してください。'
                : !cue.words.length ? '語の時刻（words[]）がない字幕では強調を設定できません。'
                    : '出力時間軸の字幕では source 時刻の語を選べません。';
            emphasisSection.appendChild(reason);
        } else {
            const chips = document.createElement('div');
            chips.className = 'akari-caption-motion-words';
            const paintChips = (): void => chips.querySelectorAll('button').forEach((button, index) =>
                button.setAttribute('aria-pressed', String(index === selected)));
            cue.words.forEach((word, index) => {
                const chip = document.createElement('button');
                chip.type = 'button'; chip.textContent = word.text;
                chip.addEventListener('click', () => { selected = index; paintChips(); });
                chips.appendChild(chip);
            });
            paintChips();
            emphasisSection.appendChild(chips);
        }
        grid(CAPTION_EMPHASIS_STYLES.map(item => ({ ...item,
            kind: 'emphasis' as const,
            animation: ({ 'one-char-bang': 'pop', 'one-char-jumble': 'jitter',
                'size-pulse': 'heartbeat', 'color-accent': 'neon-flicker',
                'color-only': 'soft-fade', 'outline-bold': 'zoom-pop',
                danger: 'shake', positive: 'heartbeat', highlight: 'wipe-right' } as Record<string, string>)[item.id],
            disabled: !cue.words.length || cue.time_domain === 'output' || multipleCues,
            onClick: () => { void services.setEmphasis(selected, item.id).then(result => {
                if (result.ok) play(item.id, 'emphasis', selected);
                else notice.textContent = result.message ?? '強調を書き込めませんでした。';
            }); }
        })), emphasisSection);
    }).catch(error => { notice.textContent = error instanceof Error ? error.message : String(error); });
    heading('速さ・尺');
    const speed = document.createElement('input');
    speed.type = 'range'; speed.min = '0.3'; speed.max = '2'; speed.step = '0.05'; speed.value = '1';
    speed.setAttribute('aria-label', '速さ');
    speed.addEventListener('change', () => {
        const seat = animation?.[state.slot];
        if (!seat) return;
        const base = state.slot === 'loop' ? 3 : state.slot === 'out' ? .27 : .4;
        commit(captionTextAnimationWrite(snapshot.id, animation, state.slot, seat.id, base / Number(speed.value)),
            captionTextAnimationNext(animation, state.slot, seat.id, base / Number(speed.value)),
            seat.id, state.slot);
    });
    root.appendChild(speed);
    const duration = document.createElement('label');
    duration.textContent = '尺（秒）';
    const durationInput = document.createElement('input');
    durationInput.type = 'number'; durationInput.min = '0.05'; durationInput.step = '0.05';
    durationInput.value = String(animation?.[state.slot]?.durationSec
        ?? (state.slot === 'loop' ? 3 : state.slot === 'out' ? .27 : .4));
    durationInput.addEventListener('change', () => {
        const seat = animation?.[state.slot];
        const seconds = Number(durationInput.value);
        if (!seat || !Number.isFinite(seconds) || seconds <= 0) return;
        commit(captionTextAnimationWrite(snapshot.id, animation, state.slot, seat.id, seconds),
            captionTextAnimationNext(animation, state.slot, seat.id, seconds), seat.id, state.slot);
    });
    duration.appendChild(durationInput);
    root.appendChild(duration);
    root.appendChild(notice);
    return root;
}
