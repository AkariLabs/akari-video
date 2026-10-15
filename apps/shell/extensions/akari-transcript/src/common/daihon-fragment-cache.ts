import type { CaptionDisplayPolicy } from '@akari-video/edit-store';

export type DaihonFragmentResult = { fragments?: string[]; overflow: boolean };

export class DaihonFragmentCache {
    private readonly entries = new Map<string, DaihonFragmentResult>();

    key(text: string, policy: CaptionDisplayPolicy): string {
        return JSON.stringify([text, policy]);
    }

    get(key: string): DaihonFragmentResult | undefined {
        const value = this.entries.get(key);
        if (value) {
            this.entries.delete(key);
            this.entries.set(key, value);
        }
        return value;
    }

    compute(key: string, split: () => DaihonFragmentResult): DaihonFragmentResult {
        const cached = this.get(key);
        if (cached) return cached;
        const result = split();
        this.entries.set(key, result);
        if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!);
        return result;
    }
}

export function certainFragmentOverflow(units: number, maxLineUnits: number): boolean {
    return units > maxLineUnits * 6;
}
