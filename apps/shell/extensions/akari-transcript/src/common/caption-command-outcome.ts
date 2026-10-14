import type { CaptionCommandResult } from 'akari-annotations/lib/common/akari-annotations-protocol';

export async function settleCaptionCommand(result: CaptionCommandResult, actions: {
    reload(): Promise<void>; notify(message: string): void;
    conflictNotice: string; record(result: Extract<CaptionCommandResult, { ok: true }>): void
}): Promise<void> {
    if (!result.ok) {
        if ('conflict' in result) {
            await actions.reload().catch(() => undefined);
            actions.notify(actions.conflictNotice);
        } else if ('invalid' in result) actions.notify(result.message);
        return;
    }
    if (result.written.length) {
        actions.record(result);
        await actions.reload();
    }
}
