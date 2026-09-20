import * as React from '@theia/core/shared/react';
import { ApplicationShell } from '@theia/core/lib/browser';
import {
    TabBarToolbarContribution,
    TabBarToolbarRegistry
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common';
import { AnchorRect } from '../common/companion-panel-geometry';

export const COMPANION_TOGGLE_COMMAND_ID = 'akari.companion.togglePanel';
export const COMPANION_TOGGLE_ATTRIBUTE = 'data-akari-companion-toggle';
export const COMPANION_TOGGLE_LABEL = '外部の操作盤';
/**
 * 「変更を見る」は同じ group の priority 100。Theia のツールバーは
 * `items.sort(PRIORITY_COMPARATOR).reverse()` で DOM に並べたうえで、
 * 帯そのものが `flex-direction: row-reverse` なので、**priority が小さいほど左**に出る
 * （2026-09-20 実機の CDP で実測）。それより小さい値にして すぐ左 へ置く。
 */
export const COMPANION_TOGGLE_PRIORITY = 99;

/** 画面に出ているボタン（タブ帯ごとに複数ありうる）。 */
export function toolbarButtons(doc: Document): HTMLElement[] {
    return Array.prototype.slice.call(
        doc.querySelectorAll(`[${COMPANION_TOGGLE_ATTRIBUTE}]`)
    ) as HTMLElement[];
}

/** ツールバーのボタンの位置。枠はこれを基準に、押したときの真下へ出る。 */
export function toolbarAnchorRect(doc: Document): AnchorRect | undefined {
    for (const button of toolbarButtons(doc)) {
        const bounds = button.getBoundingClientRect();
        if (bounds.width > 0 || bounds.height > 0) {
            return { left: bounds.left, right: bounds.right, bottom: bounds.bottom };
        }
    }
    return undefined;
}

export interface CompanionToolbarState {
    /** 橋がつながっているあいだだけボタンを出す（相手が居なければ押すものが無い）。 */
    connected(): boolean;
    /** 枠が出ているか。ボタンの見た目（点が灯るか）に使う。 */
    open(): boolean;
}

@injectable()
export class CompanionToolbarContribution implements TabBarToolbarContribution {
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(CommandRegistry)
    protected readonly commands!: CommandRegistry;

    protected state: CompanionToolbarState | undefined;

    setState(state: CompanionToolbarState | undefined): void {
        this.state = state;
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: 'akari.companion.togglePanel.toolbar',
            command: COMPANION_TOGGLE_COMMAND_ID,
            group: 'navigation',
            priority: COMPANION_TOGGLE_PRIORITY,
            isVisible: widget => !!widget && this.shell.getAreaFor(widget) === 'main',
            render: () => this.renderButton()
        });
    }

    /**
     * ツールバーの組み直しを待たずに、いま出ているボタンの見た目だけ直す
     * （つながった / 枠を開け閉めした直後に反映させるため）。
     */
    refresh(doc: Document): void {
        const connected = Boolean(this.state?.connected());
        const open = Boolean(this.state?.open());
        for (const button of toolbarButtons(doc)) {
            button.style.display = connected ? 'inline-flex' : 'none';
            button.dataset.open = open ? 'true' : 'false';
            button.setAttribute('aria-pressed', String(open));
        }
    }

    protected renderButton(): React.ReactNode {
        const open = Boolean(this.state?.open());
        const connected = Boolean(this.state?.connected());
        return React.createElement('button', {
            type: 'button',
            className: 'theia-button secondary akari-companion-toggle',
            title: COMPANION_TOGGLE_LABEL,
            'aria-label': COMPANION_TOGGLE_LABEL,
            'aria-pressed': open,
            [COMPANION_TOGGLE_ATTRIBUTE]: '',
            'data-open': open ? 'true' : 'false',
            style: {
                alignItems: 'center',
                display: connected ? 'inline-flex' : 'none',
                height: '24px',
                justifyContent: 'center',
                margin: '0 2px 0 4px',
                padding: '0 6px',
                width: '28px'
            },
            onClick: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                void this.commands.executeCommand(COMPANION_TOGGLE_COMMAND_ID);
            }
        }, React.createElement('span', {
            className: 'codicon codicon-record akari-companion-toggle-dot',
            'aria-hidden': true
        }));
    }
}
