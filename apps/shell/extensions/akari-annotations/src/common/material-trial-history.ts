export interface TrialEntry { label: string; undo: () => Promise<void>; redo: () => Promise<void>; }
/** 未確定の 1 手。通常履歴と redo を変更するのは確定時だけ。失敗時は復元用 entry を保持する。 */
export class MaterialTrialHistory {
    entry?: TrialEntry;
    async cancel(): Promise<void> {
        const entry = this.entry;
        if (!entry) return;
        await entry.undo();
        if (this.entry === entry) this.entry = undefined;
    }
    set(entry: TrialEntry): void {
        if (this.entry) throw new Error('前のお試しを巻き戻してください。');
        this.entry = entry;
    }
    confirm(push: (entry: TrialEntry) => void): void {
        if (!this.entry) return;
        const entry = this.entry;
        entry.label = '素材を入れ替え';
        this.entry = undefined;
        push(entry);
    }
}
