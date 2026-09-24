import { MaterialContextMenuItem } from '../common/material-context-menu-items';
import { AKARI_BORDER, AKARI_LINE, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

export const OPEN_PREVIEW_IMAGE_ITEM: MaterialContextMenuItem = { id: 'open-preview-image', label: '見本画像を開く' };

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
    /** separator = この項目の前に区切り線 / icon = codicon の名前（ライブラリのカードのメニューが使う）。 */
    readonly items: readonly (MaterialContextMenuItem & { readonly separator?: boolean; readonly icon?: string })[];
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
        if (item.separator && popup.childElementCount) {
            const line = document.createElement('div');
            line.setAttribute('role', 'separator');
            Object.assign(line.style, { height: '1px', margin: '4px 6px', background: AKARI_LINE.hairline, flex: '0 0 auto' });
            popup.appendChild(line);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        if (item.icon) {
            // theia-button は中央寄せなので、記号付きの項目は左寄せの 1 列に揃える。
            Object.assign(button.style, { display: 'flex', alignItems: 'center', textAlign: 'left', width: '100%', margin: '0', minWidth: '0' });
            const icon = document.createElement('span');
            icon.className = `codicon codicon-${item.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            Object.assign(icon.style, { width: '16px', marginRight: '8px', flex: '0 0 auto', opacity: '0.85' });
            button.appendChild(icon);
            button.appendChild(document.createTextNode(item.label));
        } else {
            button.textContent = item.label;
        }
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
    // 画面の端で切れないよう、はみ出す分だけ内側へ寄せる。
    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth - 4) popup.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    if (rect.bottom > window.innerHeight - 4) popup.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
    const close = (event: PointerEvent): void => {
        if (!popup.contains(event.target as Node)) {
            document.removeEventListener('pointerdown', close, true);
            closeAkariContextMenu();
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
