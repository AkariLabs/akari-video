export interface PartnerTerminalToStop {
    readonly kind: string;
    readonly terminalId: number;
    readonly isDisposed: boolean;
    readonly exitStatus: unknown;
}

const EXIT_TIMEOUT_MS = 5000;

export function activePartnerTerminals(terminals: readonly PartnerTerminalToStop[]): PartnerTerminalToStop[] {
    return terminals.filter(terminal => terminal.kind === 'akari-partner'
        && terminal.terminalId >= 0 && !terminal.isDisposed && !terminal.exitStatus);
}

export async function stopPartnerTerminals(
    terminals: readonly PartnerTerminalToStop[],
    close: (id: number) => Promise<void>,
    timeoutMs = EXIT_TIMEOUT_MS
): Promise<void> {
    const active = activePartnerTerminals(terminals);
    await Promise.all(active.map(terminal => new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
            if (terminal.exitStatus) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() >= deadline) {
                clearInterval(timer);
                reject(new Error('Partner terminal termination could not be confirmed'));
            }
        }, 50);
        void close(terminal.terminalId).catch(error => {
            clearInterval(timer);
            reject(error);
        });
    })));
}
