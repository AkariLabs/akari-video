import { injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core';
import { Message as PlainMessage, ProgressMessage, CancellationToken } from '@theia/core/lib/common';
import { Notification, NotificationManager } from '@theia/messages/lib/browser/notifications-manager';
import { NotificationLife, notificationLifeMs } from '../common/notification-life';

@injectable()
export class AkariNotificationManager extends NotificationManager {
    readonly life = new NotificationLife({
        hideToast: id => this.hideToast(id),
        accept: (id, action) => this.accept(id, action)
    });
    private frameRequest: number | undefined;
    private readonly lifeUpdatedEmitter = new Emitter<void>();
    readonly onLifeUpdated = this.lifeUpdatedEmitter.event;
    private readonly absorbEmitter = new Emitter<string>();
    readonly onAbsorb = this.absorbEmitter.event;
    private readonly dates = new Map<string, number>();
    private readonly versions = new Map<string, number>();

    snapshot(): { notifications: Notification[]; toasts: Notification[]; visibilityState: Notification.Visibility } {
        return { notifications: [...this.notifications.values()], toasts: [...this.toasts.values()], visibilityState: this.visibilityState };
    }

    timestamp(id: string): number { return this.dates.get(id) ?? Date.now(); }
    version(id: string): number { return this.versions.get(id) ?? 0; }

    protected override init(): void {
        super.init();
        document.addEventListener('visibilitychange', () => {
            this.life.resetFrame();
            this.updateClock();
        });
    }

    private updateClock(): void {
        if (!this.life.hasCounting || document.visibilityState === 'hidden') {
            if (this.frameRequest !== undefined) cancelAnimationFrame(this.frameRequest);
            this.frameRequest = undefined;
            this.life.resetFrame();
        } else if (this.frameRequest === undefined) this.frameRequest = requestAnimationFrame(now => this.advance(now));
    }

    private advance(now: number): void {
        this.frameRequest = undefined;
        const expired = this.life.frame(now, document.visibilityState === 'hidden');
        this.lifeUpdatedEmitter.fire();
        const visible = new Set([...this.toasts.keys()].slice(-3));
        for (const id of expired) {
            if (this.toastsVisible && visible.has(id)) {
                this.absorbEmitter.fire(id);
            } else this.finishAbsorb(id);
        }
        this.updateClock();
    }

    override showMessage(message: PlainMessage): Promise<string | undefined> {
        const id = this.getMessageId(message);
        this.life.remove(id);
        this.updateClock();
        this.dates.set(id, Date.now());
        this.versions.set(id, this.version(id) + 1);
        return super.showMessage(message);
    }

    protected override getTimeout(message: PlainMessage): number {
        return notificationLifeMs(this.toNotificationType(message.type), new Set(message.actions ?? []).size,
            message.options?.timeout);
    }

    protected override startHideTimeout(messageId: string, timeout: number): void {
        const notification = this.notifications.get(messageId);
        if (notification) this.life.add(messageId, notification.type, timeout);
        this.updateClock();
        this.lifeUpdatedEmitter.fire();
    }

    override showProgress(messageId: string, message: ProgressMessage, token: CancellationToken): Promise<string | undefined> {
        const result = super.showProgress(messageId, message, token);
        if (!this.life.phase(messageId)) this.life.add(messageId, 'progress', 0);
        return result;
    }

    holdToast(id: string, reason: string, held: boolean): void {
        this.life.hold(id, reason, held);
        this.updateClock();
        this.lifeUpdatedEmitter.fire();
    }

    finishAbsorb(id: string): void {
        if (this.life.phase(id) !== 'absorbing') return;
        this.life.finishAbsorb(id, this.centerVisible);
        this.lifeUpdatedEmitter.fire();
    }

    finishDismiss(id: string, action?: string): void { this.life.finishDismiss(id, action); }
    acceptFromCenter(id: string, action: string): void { this.life.acceptFromCenter(id, action); }

    override hide(): void {
        if (this.toastsVisible) this.life.hideVisible(this.toasts.keys());
        super.hide();
        this.updateClock();
        this.lifeUpdatedEmitter.fire();
    }

    override accept(notification: Notification | string, action: string | undefined): void {
        this.dates.delete(this.getId(notification));
        this.life.remove(this.getId(notification));
        super.accept(notification, action);
        this.updateClock();
        this.lifeUpdatedEmitter.fire();
    }

    override showCenter(): void {
        this.life.openCenter();
        super.showCenter();
        this.lifeUpdatedEmitter.fire();
    }

    override toggleCenter(): void {
        if (!this.centerVisible) this.life.openCenter();
        super.toggleCenter();
        this.lifeUpdatedEmitter.fire();
    }
}
