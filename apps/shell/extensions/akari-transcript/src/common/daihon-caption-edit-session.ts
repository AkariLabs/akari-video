export class DaihonCaptionEditSession {
    private phase: 'editing' | 'closing' | 'closed' = 'editing';

    get isEditing(): boolean { return this.phase === 'editing'; }

    beginClose(): boolean {
        if (this.phase !== 'editing') return false;
        this.phase = 'closing';
        return true;
    }

    finish(): void { this.phase = 'closed'; }
}

export function seedDaihonCaptionEdit(session: { input(value: string): void }, value: string,
    compositionStart: boolean): void {
    if (!compositionStart) session.input(value);
}
