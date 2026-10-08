import { injectable } from '@theia/core/shared/inversify';
import { MenuModelRegistry } from '@theia/core';
import { FrontendApplication, StatusBarAlignment } from '@theia/core/lib/browser';
import { NotificationsContribution } from '@theia/messages/lib/browser/notifications-contribution';
import { NOTIFICATION_CONTEXT_MENU, NotificationsCommands } from '@theia/messages/lib/browser/notifications-commands';
import { AkariNotificationManager } from './akari-notification-manager';

@injectable()
export class AkariNotificationsContribution extends NotificationsContribution {
    private lastUnread = 0;
    private lastError = false;
    private lastRingableUnread = 0;
    private pendingRing = false;

    protected override createStatusBarItem(): void {
        this.updateStatusBarItem();
    }

    override registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...NOTIFICATION_CONTEXT_MENU, '_copy'], {
            commandId: NotificationsCommands.COPY_MESSAGE.id,
            label: 'メッセージをコピー'
        });
    }

    override onStart(app: FrontendApplication): void {
        super.onStart(app);
        const manager = this.manager as AkariNotificationManager;
        manager.onLifeUpdated(() => {
            const count = manager.life.unreadCount;
            const error = manager.life.hasUnreadError;
            const ringable = manager.life.ringableUnreadCount;
            if (count === this.lastUnread && error === this.lastError && ringable === this.lastRingableUnread) return;
            const increased = ringable > this.lastRingableUnread;
            this.lastUnread = count;
            this.lastError = error;
            this.lastRingableUnread = ringable;
            this.pendingRing ||= increased;
            this.updateStatusBarItem();
        });
    }

    protected override getStatusBarItemText(_count: number): string { return '$(codicon-bell)'; }

    protected override getStatusBarItemTooltip(_count: number): string {
        const count = (this.manager as AkariNotificationManager).life.unreadCount;
        return count ? `未読の通知 ${count} 件` : '通知はありません';
    }

    protected override updateStatusBarItem(count = 0): void {
        const tooltip = this.getStatusBarItemTooltip(count);
        void this.statusBar.setElement(this.id, {
            text: this.getStatusBarItemText(count),
            alignment: StatusBarAlignment.RIGHT,
            priority: -900,
            command: NotificationsCommands.TOGGLE.id,
            tooltip,
            accessibilityInformation: { label: tooltip }
        }).then(() => requestAnimationFrame(() => this.decorate()));
    }

    private decorate(): void {
        const element = document.getElementById('status-bar-theia-notification-center');
        if (!element) return;
        const manager = this.manager as AkariNotificationManager;
        const count = manager.life.unreadCount;
        element.dataset.unreadError = String(manager.life.hasUnreadError);
        let badge = element.querySelector<HTMLElement>('.akari-notification-badge');
        if (!badge && count) {
            badge = document.createElement('span');
            badge.className = 'akari-notification-badge';
            element.appendChild(badge);
        }
        if (badge) {
            badge.textContent = String(count);
            badge.hidden = count === 0;
        }
        if (!element.querySelector('.akari-bell-ripple')) {
            const ripple = document.createElement('span');
            ripple.className = 'akari-bell-ripple';
            element.appendChild(ripple);
        }
        if (this.pendingRing) {
            this.pendingRing = false;
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.ring();
        }
    }

    private ring(): void {
        const element = document.getElementById('status-bar-theia-notification-center');
        if (!element) return;
        element.classList.remove('akari-bell-ring');
        void element.offsetWidth;
        element.classList.add('akari-bell-ring');
    }
}
