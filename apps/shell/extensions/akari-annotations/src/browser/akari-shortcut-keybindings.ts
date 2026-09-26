import { CommandRegistry, Disposable } from '@theia/core/lib/common';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { WidgetManager } from '@theia/core/lib/browser';
import { isEditableEventTarget, isImeCompositionKeydown } from 'akari-preview/lib/common/review-tool-mode';
import { AkariEditHistoryService } from './akari-edit-history-service';
import { AkariAnnotationsWidget } from './akari-annotations-widget';
import { PLACE_TEXT } from './akari-annotations-commands';
import { AKARI_SHORTCUTS, AkariShortcut } from './akari-shortcuts';
import { captionEditFocusWithinMarkedWidget } from '../common/caption-edit-focus';

/** The annotations contribution supplies references; shortcut policy and execution live here. */
export interface AkariShortcutDependencies {
    contextKeys: ContextKeyService;
    history: AkariEditHistoryService;
    widgetManager: WidgetManager;
    currentTimeline: () => AkariAnnotationsWidget | undefined;
    activeWidget: () => unknown;
    trackedTimelines: () => Iterable<AkariAnnotationsWidget>;
}

export class AkariShortcutKeybindings {
    protected latestKeydown?: KeyboardEvent;

    constructor(protected readonly deps: AkariShortcutDependencies) { }

    /** The old window listener belonged to every attached timeline, not only the remembered one. */
    shortcutTimelineWidget(): AkariAnnotationsWidget | undefined {
        const available = (widget: AkariAnnotationsWidget | undefined): widget is AkariAnnotationsWidget =>
            !!widget && widget.isAttached && !widget.isDisposed;
        const current = this.deps.currentTimeline();
        if (available(current)) return current;
        const active = this.deps.activeWidget();
        if (active instanceof AkariAnnotationsWidget && available(active)) return active;
        return [...this.deps.trackedTimelines()].find(available)
            ?? this.deps.widgetManager.getWidgets(AkariAnnotationsWidget.FACTORY_ID)
                .find((widget): widget is AkariAnnotationsWidget =>
                    widget instanceof AkariAnnotationsWidget && available(widget));
    }

    start(): Disposable {
        // Theia listens at document capture. Refresh context at window capture for this exact press.
        const refreshContext = (event: KeyboardEvent): void => {
            this.latestKeydown = event;
            const widget = this.shortcutTimelineWidget();
            const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const webview = focused?.tagName === 'IFRAME'
                || (event.target instanceof HTMLElement && event.target.tagName === 'IFRAME');
            const owns = webview || !!(widget && focused && widget.node.contains(focused));
            const outside = !!focused && focused !== document.body && !owns;
            const control = focused?.closest('button, [role="button"], [tabindex]');
            const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement
                && (!!target.closest('.akari-inspector-widget') || isEditableEventTarget(target));
            const captionEditing = captionEditFocusWithinMarkedWidget(focused,
                Array.from(document.querySelectorAll('[data-akari-caption-editing-focus="true"]')));
            const modalOpen = Array.from(document.querySelectorAll('.dialogOverlay, [aria-modal="true"]'))
                .some(element => element.getClientRects().length > 0
                    && getComputedStyle(element).visibility !== 'hidden');
            this.deps.contextKeys.setContext('akariTimelineVisible', !!widget);
            this.deps.contextKeys.setContext('akariTimelineFocus', owns);
            this.deps.contextKeys.setContext('akariFocusOutsideTimeline', outside);
            this.deps.contextKeys.setContext('akariFocusOnControl', !webview && !!control && control !== widget?.node);
            this.deps.contextKeys.setContext('akariModalOpen', modalOpen);
            this.deps.contextKeys.setContext('akariEditableFocus', captionEditing || editable(event.target) || editable(focused));
            this.deps.contextKeys.setContext('akariHistoryEditableFocus',
                captionEditing || event.target instanceof HTMLElement && isEditableEventTarget(event.target)
                || !!focused && isEditableEventTarget(focused));
            this.deps.contextKeys.setContext('akariImeComposing', isImeCompositionKeydown(event));
            this.deps.contextKeys.setContext('akariTextSelection', !!window.getSelection?.()?.toString());
            this.deps.contextKeys.setContext('akariDaihonRowsFocus', !!focused?.closest('.akari-daihon-rows'));
            this.deps.contextKeys.setContext('akariInspectorFocus', !!focused?.closest('.akari-inspector-widget'));
            this.deps.contextKeys.setContext('akariInspectorSolo', !!document.querySelector('.akari-inspector-solo-banner'));
            this.deps.contextKeys.setContext('akariNumberFieldFocus', !!focused?.matches('.akari-inspector-number-input'));
            this.deps.contextKeys.setContext('akariKeyframeSelected', widget?.canRunRegisteredShortcut('akari.timeline.deleteKeyframe') === true);
        };
        window.addEventListener('keydown', refreshContext, true);
        window.removeEventListener('keydown', this.deps.history.handleKeydown, true);
        return Disposable.create(() => window.removeEventListener('keydown', refreshContext, true));
    }

    registerCommands(commands: CommandRegistry): void {
        for (const shortcut of AKARI_SHORTCUTS) {
            if (shortcut.command.id === PLACE_TEXT.id || shortcut.command.id === 'akari.timeline.toggleVisibility') continue;
            commands.registerCommand(shortcut.command, {
                isEnabled: () => this.shortcutEnabled(shortcut),
                execute: () => this.executeShortcut(shortcut)
            });
        }
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        for (const shortcut of AKARI_SHORTCUTS) {
            for (const keybinding of shortcut.keys) {
                keybindings.registerKeybinding({ command: shortcut.command.id, keybinding, when: shortcut.when });
            }
        }
    }

    protected shortcutEnabled(shortcut: AkariShortcut): boolean {
        // User keymaps may supply only command + keybinding; keep the command's focus gate.
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (captionEditFocusWithinMarkedWidget(focused,
            typeof document.querySelectorAll === 'function'
                ? Array.from(document.querySelectorAll('[data-akari-caption-editing-focus="true"]')) : [])) return false;
        if (!this.deps.contextKeys.match(shortcut.when, focused)) return false;
        const id = shortcut.command.id;
        const widget = this.shortcutTimelineWidget();
        if (id.endsWith('.delete') || id.endsWith('.deleteOneSide') || id.endsWith('.deleteKeyframe')) {
            return widget?.canRunRegisteredShortcut(id) === true;
        }
        if (id === 'akari.timeline.clearSelection') {
            return widget?.canRunRegisteredShortcut(id) === true;
        }
        if (id === 'akari.timeline.selectParent' || id === 'akari.timeline.selectChild') {
            return widget?.canRunRegisteredShortcut(id) === true;
        }
        return true;
    }

    protected executeShortcut(shortcut: AkariShortcut): void {
        const id = shortcut.command.id;
        const widget = this.shortcutTimelineWidget();
        if (id === 'akari.timeline.undo' || id === 'akari.timeline.redo') {
            const operation = id.endsWith('.redo') ? this.deps.history.redo() : this.deps.history.undo();
            void operation.catch(error => console.warn('[akari-annotations] history shortcut is no longer applicable', error));
            return;
        }
        if (id === 'akari.timeline.selectTool' || id === 'akari.timeline.razorTool'
            || id === 'akari.timeline.frameTool') {
            const tool = id.endsWith('selectTool') ? 'select' : id.endsWith('razorTool') ? 'razor' : 'frame';
            widget?.setTimelineToolMode(tool);
            return;
        }
        if (id === 'akari.timeline.toggleSnap') {
            if (widget) widget.setTimelineSnapEnabled(!widget.getTimelineSnapEnabled());
            return;
        }
        if (id.startsWith('akari.daihon.')) {
            window.dispatchEvent(new CustomEvent('akari.daihon.rowShortcut', {
                detail: id.endsWith('selectAllRows') ? 'selectAll' : 'clear'
            }));
            return;
        }
        if (id === 'akari.inspector.clearSolo') {
            window.dispatchEvent(new Event('akari.inspector.clearSoloShortcut'));
            return;
        }
        if (id.startsWith('akari.inspector.step')) {
            document.activeElement?.dispatchEvent(new CustomEvent('akari.inspector.numberStepShortcut', {
                detail: { key: shortcut.key, shiftKey: shortcut.shift === true }
            }));
            return;
        }
        const source = this.latestKeydown;
        const event = {
            key: shortcut.key, code: shortcut.key === ' ' ? 'Space' : source?.code,
            shiftKey: shortcut.shift === true, altKey: shortcut.alt === true,
            metaKey: shortcut.modifier === true, ctrlKey: false,
            isComposing: false, keyCode: 0,
            target: source?.target ?? document.activeElement,
            preventDefault: () => undefined, stopPropagation: () => undefined
        } as KeyboardEvent;
        widget?.runRegisteredShortcut(event);
    }
}
