import * as React from '@theia/core/shared/react';
import * as DOMPurify from '@theia/core/shared/dompurify';
import { codicon, ContextMenuRenderer } from '@theia/core/lib/browser';
import { Notification } from '@theia/messages/lib/browser/notifications-manager';
import { NotificationsRenderer } from '@theia/messages/lib/browser/notifications-renderer';
import { NOTIFICATION_CONTEXT_MENU } from '@theia/messages/lib/browser/notifications-commands';
import { injectable } from '@theia/core/shared/inversify';
import { AkariNotificationManager } from './akari-notification-manager';

const CIRCUMFERENCE = 56.55;

function relativeTime(at: number): string {
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes} 分前`;
    return `${Math.floor(minutes / 60)} 時間前`;
}

function NotificationRow({ notification, manager, contextMenuRenderer, toast }: {
    notification: Notification;
    manager: AkariNotificationManager;
    contextMenuRenderer: ContextMenuRenderer;
    toast: boolean;
}): React.ReactElement {
    const { messageId, message, type, progress, actions, source, expandable, collapsed } = notification;
    const isProgress = type === 'progress' || typeof progress === 'number';
    const row = React.useRef<HTMLDivElement>(null);
    const exiting = React.useRef(false);
    const [, refresh] = React.useState(0);
    React.useEffect(() => {
        if (!toast) return;
        const subscription = manager.onLifeUpdated(() => refresh(value => value + 1));
        return () => subscription.dispose();
    }, [manager, toast]);

    const fixExitingRow = (element: HTMLDivElement): DOMRect => {
        const others = Array.from(element.parentElement!.querySelectorAll<HTMLElement>('.akari-notification-row'))
            .filter(other => other !== element && other.dataset.exit === 'none');
        const before = others.map(other => other.getBoundingClientRect().top);
        const rect = element.getBoundingClientRect();
        Object.assign(element.style, {
            position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '10', margin: '0'
        });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            others.forEach((other, index) => {
                const delta = before[index] - other.getBoundingClientRect().top;
                if (Math.abs(delta) > 1) other.animate([
                    { transform: `translateY(${delta}px)` }, { transform: 'none' }
                ], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
            });
        }
        return rect;
    };

    const fade = (action?: string): void => {
        if (exiting.current) return;
        exiting.current = true;
        manager.holdToast(messageId, 'exit', true);
        const element = row.current;
        if (!element) { manager.finishDismiss(messageId, action); return; }
        element.dataset.exit = 'dismissing';
        fixExitingRow(element);
        const animation = element.animate([
            { opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }
        ], { duration: 160, easing: 'ease-out', fill: 'forwards' });
        animation.onfinish = () => manager.finishDismiss(messageId, action);
    };

    React.useEffect(() => {
        if (!toast) return;
        const subscription = manager.onAbsorb(id => {
            if (id !== messageId || exiting.current) return;
            exiting.current = true;
            const element = row.current;
            if (!element) { manager.finishAbsorb(id); return; }
            element.dataset.exit = 'absorbing';
            const bell = document.getElementById('status-bar-theia-notification-center');
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const from = fixExitingRow(element);
            const to = bell?.getBoundingClientRect();
            const useBell = !!to?.width && !!to.height && !reduced;
            const duration = useBell ? 580 : 160;
            if (useBell && to) {
                element.style.transformOrigin = `${to.left + to.width / 2 - from.left}px ${to.top + to.height / 2 - from.top}px`;
            }
            const animation = useBell ? element.animate([
                { transform: 'scale(1,1)', opacity: 1, borderRadius: '14px', offset: 0 },
                { transform: 'scale(1.02,1.02)', opacity: 1, borderRadius: '14px', offset: .16 },
                { transform: 'scale(.4,.62)', opacity: .95, borderRadius: '44px', offset: .6 },
                { transform: 'scale(.03,.03)', opacity: .55, borderRadius: '90px', offset: 1 }
            ], { duration, easing: 'cubic-bezier(.5,0,.75,.2)', fill: 'forwards' }) : element.animate([
                { opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }
            ], { duration: Math.min(duration, 160), easing: 'ease-out', fill: 'forwards' });
            animation.onfinish = () => manager.finishAbsorb(id);
        });
        return () => subscription.dispose();
    }, [manager, messageId, toast]);

    const onContextMenu = (event: React.MouseEvent<HTMLElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        contextMenuRenderer.render({ menuPath: NOTIFICATION_CONTEXT_MENU,
            anchor: { x: event.clientX, y: event.clientY }, args: [notification], context: event.currentTarget });
    };
    const onMessageClick = (event: React.MouseEvent<HTMLSpanElement>): void => {
        const target = event.target as HTMLElement;
        const link = target.closest('a');
        if (link) {
            event.stopPropagation();
            event.preventDefault();
            void manager.openLink(link.href);
        }
    };
    const fraction = toast ? manager.life.fraction(messageId) : undefined;
    return <div ref={row} className='theia-notification-list-item-container akari-notification-row'
        data-message-id={messageId}
        data-kind={type} data-exit='none' role={toast ? type === 'error' ? 'alert' : 'status' : undefined}
        onContextMenu={onContextMenu}
        onPointerEnter={toast ? () => manager.holdToast(messageId, 'pointer', true) : undefined}
        onPointerLeave={toast ? () => manager.holdToast(messageId, 'pointer', false) : undefined}
        onFocusCapture={toast ? () => manager.holdToast(messageId, 'focus', true) : undefined}
        onBlurCapture={toast ? event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                manager.holdToast(messageId, 'focus', false);
            }
        } : undefined}>
        <div className='theia-notification-list-item' tabIndex={0}>
            <div className={`theia-notification-list-item-content ${collapsed ? 'collapsed' : ''}`}>
                <div className='theia-notification-list-item-content-main'>
                    <span className={`theia-notification-icon ${codicon(type === 'progress' ? 'info' : type)} ${type}`} aria-hidden='true' />
                    <div className='theia-notification-message'>
                        <span onClick={onMessageClick}
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message, { ALLOW_UNKNOWN_PROTOCOLS: true }) }} />
                        {source && <small className='theia-notification-source'>{source}</small>}
                        {!!actions.length && <div className='theia-notification-buttons'>
                            {actions.map((action, index) => <button key={`${messageId}-${index}`} type='button'
                                className={`akari-notification-button ${actions.length >= 2 && index === 0 ? 'primary' : ''}`}
                                data-message-id={messageId} data-action={action}
                                onClick={() => toast ? fade(action) : manager.acceptFromCenter(messageId, action)}>{action}</button>)}
                        </div>}
                    </div>
                    <div className='theia-notification-actions'>
                        {!toast && <span className='akari-notification-time'>{relativeTime(manager.timestamp(messageId))}</span>}
                        {expandable && <button className={`akari-notification-expand ${codicon('chevron-down', true)}`}
                            type='button' aria-label={collapsed ? '展開' : '折りたたむ'}
                            onClick={() => manager.toggleExpansion(messageId)} />}
                        {toast ? !isProgress && <button className='akari-notification-close' type='button' aria-label='閉じる'
                            data-message-id={messageId} onClick={() => fade()}>
                            {fraction !== undefined && <svg className='akari-notification-ring' viewBox='0 0 22 22' aria-hidden='true'>
                                <circle className='akari-ring-bg' cx='11' cy='11' r='9' />
                                <circle className='akari-ring-fg' cx='11' cy='11' r='9'
                                    style={{ strokeDashoffset: CIRCUMFERENCE * (1 - fraction) }} />
                            </svg>}
                            <span aria-hidden='true'>×</span>
                        </button> : !isProgress && <button className='akari-notification-close' type='button'
                            aria-label='閉じる' onClick={() => manager.clear(messageId)}>×</button>}
                    </div>
                </div>
            </div>
            {isProgress && <div className='theia-notification-item-progress'>
                <div className={`theia-notification-item-progressbar ${progress ? 'determinate' : 'indeterminate'}`}
                    style={{ width: `${progress ?? 100}%` }} />
            </div>}
        </div>
    </div>;
}

function NotificationSurface({ manager, contextMenuRenderer, silent }: {
    manager: AkariNotificationManager; contextMenuRenderer: ContextMenuRenderer; silent: () => boolean;
}): React.ReactElement {
    const [snapshot, setSnapshot] = React.useState(() => manager.snapshot());
    const previousPositions = React.useRef(new Map<string, number>());
    React.useEffect(() => {
        const subscription = manager.onUpdated(() => {
            const positions = new Map<string, number>();
            document.querySelectorAll<HTMLElement>('.theia-notification-toasts .akari-notification-row').forEach(element => {
                if (element.dataset.messageId) positions.set(element.dataset.messageId, element.getBoundingClientRect().top);
            });
            previousPositions.current = positions;
            setSnapshot(manager.snapshot());
        });
        setSnapshot(manager.snapshot());
        return () => subscription.dispose();
    }, [manager]);
    React.useLayoutEffect(() => {
        document.querySelectorAll<HTMLElement>('.theia-notification-toasts .akari-notification-row').forEach(element => {
            const before = previousPositions.current.get(element.dataset.messageId ?? '');
            const after = element.getBoundingClientRect().top;
            if (before !== undefined && Math.abs(before - after) > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                element.animate([{ transform: `translateY(${before - after}px)` }, { transform: 'none' }],
                    { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
            }
        });
        previousPositions.current.clear();
    }, [snapshot]);
    const centerOpen = snapshot.visibilityState === 'center';
    const toastsOpen = snapshot.visibilityState === 'toasts' && !silent();
    return <div>
        <div className={`theia-notifications-container theia-notification-toasts ${toastsOpen ? 'open' : 'closed'}`}>
            <div className='theia-notification-list'>
                {snapshot.toasts.slice(-3).map(notification => <NotificationRow key={`${notification.messageId}-${manager.version(notification.messageId)}`}
                    notification={notification} manager={manager} contextMenuRenderer={contextMenuRenderer} toast />)}
            </div>
        </div>
        <div className={`theia-notifications-container theia-notification-center ${centerOpen ? 'open' : 'closed'}`}>
            <div className='theia-notification-center-header'>
                <span className='theia-notification-center-header-title'>通知</span>
                <div className='theia-notification-center-header-actions'>
                    <button className='akari-notification-clear' type='button' onClick={() => manager.clearAll()}>すべて消す</button>
                    <button className={`akari-notification-hide ${codicon('chevron-down', true)}`} type='button'
                        aria-label='通知を閉じる' onClick={() => manager.hideCenter()} />
                </div>
            </div>
            <div className='theia-notification-list-scroll-container'>
                <div className='theia-notification-list'>
                    <div className='akari-notification-items'>
                        {snapshot.notifications.length ? snapshot.notifications.slice().reverse().map(notification =>
                            <NotificationRow key={`${notification.messageId}-${manager.version(notification.messageId)}`} notification={notification} manager={manager}
                                contextMenuRenderer={contextMenuRenderer} toast={false} />)
                            : <div className='akari-notification-empty'>新しい通知はありません</div>}
                    </div>
                </div>
            </div>
        </div>
    </div>;
}

@injectable()
export class AkariNotificationsRenderer extends NotificationsRenderer {
    protected override render(): void {
        this.containerRoot.render(<NotificationSurface manager={this.manager as AkariNotificationManager}
            contextMenuRenderer={this.contextMenuRenderer}
            silent={() => this.corePreferences['workbench.silentNotifications']} />);
    }
}
