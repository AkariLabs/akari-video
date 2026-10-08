import { PartnerTurnDetector } from './partner-turn-detector';

/** 端末ごとの出力から作業中状態を作る。 */
export class PartnerActivityState {
    private readonly detectors = new Map<string, PartnerTurnDetector>();
    private readonly busy = new Set<string>();

    get anyBusy(): boolean { return this.busy.size > 0; }
    isBusy(id: string): boolean { return this.busy.has(id); }

    feed(id: string, chunk: string, now: number): boolean {
        let detector = this.detectors.get(id);
        if (!detector) {
            detector = new PartnerTurnDetector();
            this.detectors.set(id, detector);
        }
        const armed = detector.feed(chunk, now).armed;
        const before = this.busy.has(id);
        if (armed) this.busy.add(id); else this.busy.delete(id);
        return before !== armed;
    }

    nextCheckDelayMs(id: string, now: number): number | undefined {
        return this.detectors.get(id)?.nextCheckDelayMs(now);
    }

    checkTurnEnd(id: string, now: number): boolean {
        if (!this.detectors.get(id)?.checkTurnEnd(now)) return false;
        return this.busy.delete(id);
    }

    close(id: string): boolean {
        this.detectors.delete(id);
        return this.busy.delete(id);
    }
}
