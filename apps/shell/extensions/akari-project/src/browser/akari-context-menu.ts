import { MaterialContextMenuItem } from '../common/material-context-menu-items';
import { AKARI_BORDER, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

/**
 * 素材パネルの右クリックメニュー実装（task 2026-08-09-material-context-menu-mvp 指示1）。
 * `akari-annotations-widget.ts` の `openTrackContextMenu` と同型の DOM ポップアップ
 * （司令塔裁定3 — Theia の MenuModelRegistry / ContextMenuRenderer には乗せない）:
 * `document.body` へ fixed 配置・`theia-button secondary`・外側 `pointerdown` capture で
 * 閉じる・popup 上の contextmenu は preventDefault・新しいメニューを開くとき既存 popup は
 * 自動で閉じる（モジュール内で単一のアクティブ popup を保持）。
 */
export interface OpenAkariContextMenuOptions {
    readonly x: number;
    readonly y: number;
    readonly items: readonly MaterialContextMenuItem[];
    readonly onSelect: (id: string) => void;
}

let activePopup: HTMLDivElement | undefined;

export function closeAkariContextMenu(): void {
    activePopup?.remove();
    activePopup = undefined;
}

export function openAkariContextMenu(options: OpenAkariContextMenuOptions): void {
    closeAkariContextMenu();
    const popup = document.createElement('div');
    popup.setAttribute('data-akari-context-menu', 'true');
    Object.assign(popup.style, {
        position: 'fixed',
        left: `${options.x}px`,
        top: `${options.y}px`,
        zIndex: '10000',
        display: 'flex',
        flexDirection: 'column',
        minWidth: '176px',
        padding: '4px',
        borderRadius: `${AKARI_RADIUS.panel}px`,
        border: AKARI_BORDER.hairline,
        background: AKARI_SURFACE.raised,
        boxShadow: '0 3px 12px rgba(0,0,0,.35)'
    });
    for (const item of options.items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        button.textContent = item.label;
        button.dataset.akariContextItem = item.id;
        button.style.justifyContent = 'flex-start';
        if (item.danger) {
            button.style.color = 'var(--theia-errorForeground)';
        }
        button.addEventListener('click', () => {
            closeAkariContextMenu();
            options.onSelect(item.id);
        });
        popup.appendChild(button);
    }
    popup.addEventListener('contextmenu', event => event.preventDefault());
    document.body.appendChild(popup);
    activePopup = popup;
    const close = (event: PointerEvent): void => {
        if (!popup.contains(event.target as Node)) {
            document.removeEventListener('pointerdown', close, true);
            closeAkariContextMenu();
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
