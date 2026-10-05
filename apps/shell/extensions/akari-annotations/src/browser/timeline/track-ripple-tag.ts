import { cycleTrackRippleMode, isFollowingCaptionTrack, RippleTagPresentation, rippleSwitchValues,
    setTrackRippleSwitch } from '../../common/track-ripple-tag';
import { setTrackRippleMode } from '@akari-video/edit-store';
import type { EditV2, RippleMode, TrackV2 } from '@akari-video/edit-store';
import type { PreferenceService } from '@theia/core/lib/common/preferences';

export const TRACK_RIPPLE_DISPLAY_PREFERENCE = 'akari.timeline.trackRippleDisplay';

export function observeTrackRippleDisplay(preferences: PreferenceService, render: () => void): { dispose(): void } {
    return preferences.onPreferenceChanged(event => {
        if (event.preferenceName === TRACK_RIPPLE_DISPLAY_PREFERENCE) render();
    });
}

function stop(event: Event): void { event.preventDefault(); event.stopPropagation(); }

function icon(className: string): HTMLSpanElement {
    const element = document.createElement('span');
    element.className = `akari-track-ripple-icon codicon ${className}`;
    element.setAttribute('aria-hidden', 'true');
    return element;
}

export function createTrackRippleControl(
    track: TrackV2, presentation: RippleTagPresentation, display: 'tag' | 'switches',
    commit: (mutate: (edit: EditV2) => EditV2) => void
): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'akari-track-ripple-control';
    wrap.dataset.akariRippleTrack = track.id;
    wrap.dataset.akariRipplePlacement = presentation.placement;
    wrap.addEventListener('pointerdown', stop);
    if (presentation.kind === 'follow') {
        wrap.classList.add('akari-track-ripple-follow');
        wrap.title = presentation.title;
        wrap.appendChild(icon(presentation.icon));
        const label = document.createElement('span');
        label.textContent = presentation.label;
        if (presentation.compact) label.className = 'akari-track-ripple-visually-hidden';
        wrap.appendChild(label);
        return wrap;
    }
    if (display === 'switches') {
        wrap.dataset.akariRippleDisplay = 'switches';
        const values = rippleSwitchValues(track);
        for (const [field, label, iconName, title] of [
            ['target', 'ターゲット', 'codicon-target', 'ターゲット: 範囲を消すトラック'],
            ['sync', '同期ロック', 'codicon-link', '同期ロック: 消さないが後ろを一緒に寄せる']
        ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-track-ripple-switch';
            button.dataset.akariRippleSwitch = field;
            button.title = title;
            button.setAttribute('aria-label', `${label}: ${values[field] ? 'オン' : 'オフ'}`);
            button.setAttribute('aria-pressed', String(values[field]));
            button.disabled = presentation.disabled;
            button.appendChild(icon(iconName));
            if (!presentation.compact) {
                const text = document.createElement('span');
                text.textContent = label;
                button.appendChild(text);
            }
            button.addEventListener('click', event => {
                stop(event);
                commit(edit => setTrackRippleSwitch(edit, track.id, field, !values[field]));
            });
            wrap.appendChild(button);
        }
    } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'akari-track-ripple-tag';
        button.dataset.akariRippleTag = track.id;
        button.dataset.akariRippleMode = presentation.mode;
        button.title = presentation.title;
        button.setAttribute('aria-label', presentation.title);
        button.disabled = presentation.disabled;
        button.appendChild(icon(presentation.icon));
        if (!presentation.compact) {
            const label = document.createElement('span'); label.textContent = presentation.label;
            button.appendChild(label);
        }
        button.addEventListener('click', event => { stop(event); commit(edit => cycleTrackRippleMode(edit, track.id)); });
        wrap.appendChild(button);
    }
    return wrap;
}

/** 余裕のある行では元の見出し部品を 1 行目に保ち、札だけを 2 行目に置く。 */
export function placeTrackRippleHeaderLines(row: HTMLDivElement): void {
    const control = row.querySelector<HTMLElement>(':scope > .akari-track-ripple-control[data-akari-ripple-placement="second"]');
    if (!control) return;
    const firstLine = document.createElement('div');
    firstLine.className = 'akari-track-header-trackline';
    for (const child of Array.from(row.children)) {
        if (child !== control && !child.classList.contains('akari-track-header-resize-handle')) firstLine.appendChild(child);
    }
    row.insertBefore(firstLine, control);
}

export function createTrackRippleMenuButton(open: (anchor: HTMLElement) => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'akari-track-ripple-menu-button codicon codicon-settings-gear';
    button.dataset.akariRippleMenu = 'true';
    button.title = 'トラックの詰め方をまとめて切り替える';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', event => { stop(event); open(button); });
    return button;
}

export function openTrackRipplePresetMenu(
    anchor: HTMLElement, selectedLabel: string, onChoose: (preset: 'defaults' | 'all-cut' | 'selected-cut') => void
): HTMLDivElement {
    const popup = document.createElement('div');
    popup.className = 'akari-track-ripple-popup';
    popup.dataset.akariRipplePopup = 'true';
    const rect = anchor.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom}px`;
    for (const [preset, label] of [
        ['defaults', 'おすすめ既定に戻す（保存値を消す）'],
        ['all-cut', '全トラックを切る'],
        ['selected-cut', selectedLabel]
    ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.akariRipplePreset = preset;
        button.textContent = label;
        button.addEventListener('click', event => { stop(event); onChoose(preset); });
        popup.appendChild(button);
    }
    return popup;
}

export function appendTrackRippleContextActions(
    popup: HTMLElement, track: TrackV2, locked: boolean,
    choose: (mode: RippleMode) => void
): void {
    if (isFollowingCaptionTrack(track)) return;
    for (const [mode, label] of [['cut', '切る'], ['shift', 'ずらす'], ['fixed', '固定']] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        button.style.justifyContent = 'flex-start';
        button.textContent = `このトラック: ${label}`;
        button.disabled = locked;
        button.addEventListener('click', () => choose(mode));
        popup.appendChild(button);
    }
}

export function modeMutation(trackId: string, mode: RippleMode): (edit: EditV2) => EditV2 {
    return edit => setTrackRippleMode(edit, trackId, mode);
}
