export type PromptRoute =
    | { route: 'pty' }
    | { route: 'reattach-pty' }
    | { route: 'copy'; form: 'extension' | 'web'; agent: string; focusCommandId?: string }
    | { route: 'none' };

export function resolvePromptRoute(input: {
    hasChannel: boolean;
    hasLiveTerminal: boolean;
    visibleExtension?: { agent: string; focusCommandId?: string };
    webPartner?: { agent: string };
}): PromptRoute {
    if (input.hasChannel) return { route: 'pty' };
    if (input.hasLiveTerminal) return { route: 'reattach-pty' };
    if (input.visibleExtension) return { route: 'copy', form: 'extension', ...input.visibleExtension };
    if (input.webPartner) return { route: 'copy', form: 'web', agent: input.webPartner.agent };
    return { route: 'none' };
}
