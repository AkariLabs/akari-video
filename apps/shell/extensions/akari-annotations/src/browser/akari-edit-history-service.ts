import { Emitter, Event } from '@theia/core/lib/common';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { isEditableEventTarget } from 'akari-preview/lib/common/review-tool-mode';

const HISTORY_LIMIT = 50;

export interface HistoryEntry {
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    label: string;
}

export interface HistoryExecution {
    readonly kind: 'undo' | 'redo';
    readonly entry: HistoryEntry;
    readonly error?: unknown;
}

@injectable()
export class AkariEditHistoryService {

    protected past: HistoryEntry[] = [];
    protected future: HistoryEntry[] = [];

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected readonly onDidExecuteEmitter = new Emitter<HistoryExecution>();
    readonly onDidExecute: Event<HistoryExecution> = this.onDidExecuteEmitter.event;

    @postConstruct()
    protected init(): void {
        window.addEventListener('keydown', this.handleKeydown, true);
    }

    readonly handleKeydown = (event: KeyboardEvent): void => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
            return;
        }
        if (isEditableEventTarget(event.target as HTMLElement | null)
            || isEditableEventTarget(document.activeElement as HTMLElement | null)) {
            return;
        }
        // 履歴は共有サービスが所有するため、特定ウィジェットの attach 状態では制限しない。
        event.preventDefault();
        event.stopPropagation();
        const execution = event.shiftKey ? this.redo() : this.undo();
        void execution.catch(error => {
            console.warn('[akari-annotations] history shortcut is no longer applicable', error);
        });
    };

    push(entry: HistoryEntry): HistoryEntry {
        this.past = [...this.past, entry].slice(-HISTORY_LIMIT);
        this.future = [];
        this.onDidChangeEmitter.fire();
        return entry;
    }

    async undo(): Promise<void> {
        const entry = this.past.pop();
        if (!entry) {
            return;
        }
        try {
            await entry.undo();
            this.future = [...this.future, entry].slice(-HISTORY_LIMIT);
            this.onDidExecuteEmitter.fire({ kind: 'undo', entry });
        } catch (error) {
            this.onDidExecuteEmitter.fire({ kind: 'undo', entry, error });
            // UI 側が失敗を表示できるよう、実行元へ reject をそのまま伝播する。
            throw error;
        } finally {
            this.onDidChangeEmitter.fire();
        }
    }

    async redo(): Promise<void> {
        const entry = this.future.pop();
        if (!entry) {
            return;
        }
        try {
            await entry.redo();
            this.past = [...this.past, entry].slice(-HISTORY_LIMIT);
            this.onDidExecuteEmitter.fire({ kind: 'redo', entry });
        } catch (error) {
            this.onDidExecuteEmitter.fire({ kind: 'redo', entry, error });
            // UI 側が失敗を表示できるよう、実行元へ reject をそのまま伝播する。
            throw error;
        } finally {
            this.onDidChangeEmitter.fire();
        }
    }

    isTop(entry: HistoryEntry): boolean {
        return this.past[this.past.length - 1] === entry;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }
}
