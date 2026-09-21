import crypto from 'node:crypto';

const frame = instruction => `id: ${instruction.id}\ndata: ${JSON.stringify(instruction)}\n\n`;

export class CompanionLink {
    constructor({ timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout,
        randomId = () => crypto.randomUUID() } = {}) {
        this.timeoutMs = timeoutMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.randomId = randomId;
        this.clients = new Set();
        this.pending = new Map();
        this.sequenceById = new Map();
        this.sequence = 0;
    }

    addClient(res, lastEventId = null) {
        this.clients.add(res);
        const last = lastEventId == null ? -1 : this.sequenceById.get(String(lastEventId)) ?? -1;
        for (const row of this.pending.values()) {
            if (row.sequence > last) res.write(frame(row.instruction));
        }
        return () => this.clients.delete(res);
    }

    async sendInstruction(kind, args) {
        if (this.clients.size === 0) return { ok: false, error: 'not-connected' };
        const id = this.randomId();
        const instruction = { id, kind, ...(args === undefined ? {} : { [kind]: args }) };
        return new Promise(resolve => {
            const row = { instruction, sequence: ++this.sequence, resolve, timer: null };
            this.sequenceById.set(id, row.sequence);
            if (this.sequenceById.size > 4096) this.sequenceById.delete(this.sequenceById.keys().next().value);
            row.timer = this.setTimer(() => {
                if (!this.pending.delete(id)) return;
                resolve({ id, ok: false, error: 'timeout' });
            }, this.timeoutMs);
            this.pending.set(id, row);
            const payload = frame(instruction);
            for (const client of this.clients) client.write(payload);
        });
    }

    receiveResult(result) {
        const id = typeof result?.id === 'string' ? result.id : null;
        const row = id && this.pending.get(id);
        if (!row) return false;
        this.pending.delete(id);
        this.clearTimer(row.timer);
        row.resolve(result);
        return true;
    }

    close() {
        for (const client of this.clients) client.end();
        this.clients.clear();
        for (const [id, row] of this.pending) {
            this.clearTimer(row.timer);
            row.resolve({ id, ok: false, error: 'not-connected' });
        }
        this.pending.clear();
        this.sequenceById.clear();
    }
}

export function createInstructionSenders(link, currentProjectSessionId) {
    return {
        sendCommand: (commandId, args) => link.sendInstruction('command', { commandId, ...(args === undefined ? {} : { args }) }),
        sendFlyTo: target => link.sendInstruction('flyTo', { target }),
        sendAnnotate: args => link.sendInstruction('annotate', { projectSessionId: currentProjectSessionId(), ...args }),
    };
}
