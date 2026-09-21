import { contextMenuPosition } from '../common/context-menu-position';
import { TimelineClipMenuItem } from '../common/timeline-context-menu-items';

/**
 * タイムラインのクリップ右クリックメニュー実装（task 2026-08-10-timeline-clip-menu 指示1）。
 * akari-project の `akari-context-menu.ts`（前タスク成果）と同型の DOM ポップアップ
 * （司令塔裁定7 — 拡張間 import はせず、コピー実装する）:
 * `document.body` へ fixed 配置・`theia-button secondary`・外側 `pointerdown` capture で
 * 閉じる・popup 上の contextmenu は preventDefault・新しいメニューを開くとき既存 popup は
 * 自動で閉じる（モジュール内で単一のアクティブ popup を保持）。
 */
export interface OpenTimelineContextMenuOptions {
    readonly x: number;
    readonly y: number;
    readonly items: readonly TimelineClipMenuItem[];
    readonly onSelect: (id: string, event: MouseEvent) => void;
}

/** 所有外の共通項目列を変えず、SFX 専用トリマー入口を削除の直前へ合成する。 */
export function withAudioTrimMenuItem(
    items: readonly TimelineClipMenuItem[], enabled: boolean
): TimelineClipMenuItem[] {
    if (!enabled) return [...items];
    const deleteIndex = items.findIndex(item => item.id === 'delete');
    const insertAt = deleteIndex >= 0 ? deleteIndex : items.length;
    return [
        ...items.slice(0, insertAt),
        { id: 'audio-trim', label: 'トリム（in/out）' },
        ...items.slice(insertAt)
    ];
}

let activePopup: HTMLDivElement | undefined;

export function closeTimelineContextMenu(): void {
    activePopup?.remove();
    activePopup = undefined;
}

export function openTimelineContextMenu(options: OpenTimelineContextMenuOptions): void {
    closeTimelineContextMenu();
    const popup = document.createElement('div');
    popup.setAttribute('data-akari-context-menu', 'true');
    Object.assign(popup.style, {
        position: 'fixed',
        visibility: 'hidden',
        boxSizing: 'border-box',
        maxHeight: 'calc(100vh - 8px)',
        maxWidth: 'calc(100vw - 8px)',
        overflow: 'auto',
        left: `${options.x}px`,
        top: `${options.y}px`,
        zIndex: '10000',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 'min(156px, calc(100vw - 8px))',
        padding: '4px',
        borderRadius: '4px',
        border: '1px solid var(--theia-widget-border)',
        background: 'var(--theia-menu-background)',
        boxShadow: '0 3px 12px rgba(0,0,0,.35)'
    });
    for (const item of options.items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        button.textContent = item.label;
        button.dataset.akariContextItem = item.id;
        button.style.justifyContent = 'flex-start';
        if (item.disabled) {
            button.disabled = true;
            button.style.opacity = '.45';
            button.style.cursor = 'not-allowed';
            button.title = item.disabledReason ?? '';
        }
        if (item.danger) {
            button.style.color = 'var(--theia-errorForeground)';
        }
        button.addEventListener('click', event => {
            if (item.disabled) return;
            closeTimelineContextMenu();
            options.onSelect(item.id, event);
        });
        popup.appendChild(button);
    }
    popup.addEventListener('contextmenu', event => event.preventDefault());
    document.body.appendChild(popup);
    const bounds = popup.getBoundingClientRect();
    const position = contextMenuPosition(options, bounds, { width: window.innerWidth, height: window.innerHeight });
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
    popup.style.visibility = 'visible';
    activePopup = popup;
    const close = (event: PointerEvent): void => {
        if (!popup.contains(event.target as Node)) {
            document.removeEventListener('pointerdown', close, true);
            closeTimelineContextMenu();
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
