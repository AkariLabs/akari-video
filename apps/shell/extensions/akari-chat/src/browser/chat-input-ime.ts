export class ChatInputIme {
    composing = false;
    private suppressEnterUntil = 0;

    constructor(private readonly now: () => number = Date.now) {}

    start(): void { this.composing = true; this.suppressEnterUntil = 0; }
    end(): void { this.composing = false; this.suppressEnterUntil = this.now() + 50; }

    shouldPreventDefault(key: string, native: { keyCode?: number }): boolean {
        return this.composing && key === 'Enter' && native.keyCode !== 229;
    }

    shouldIgnoreKey(key: string, native: { isComposing?: boolean; keyCode?: number }): boolean {
        if (this.composing || native.isComposing || native.keyCode === 229) return true;
        if (key === 'Enter' && this.suppressEnterUntil > 0 && this.now() <= this.suppressEnterUntil) {
            this.suppressEnterUntil = 0;
            return true;
        }
        return false;
    }

    shouldCommitInput(native: { isComposing?: boolean }): boolean {
        return !this.composing && !native.isComposing;
    }
}
