export const EXPORT_SHARE_TARGETS = [
    { id: 'x', label: 'X', url: 'https://x.com/compose/post' },
    { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/upload' },
    { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/' },
    { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/upload' }
] as const;

export type ExportShareTargetId = typeof EXPORT_SHARE_TARGETS[number]['id'];

export function composeExportHandOffPacket(input: {
    artifactPath: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    fps?: number;
    bytes?: number;
    engine?: string;
}): string {
    const facts = [`パス: ${input.artifactPath}`];
    if (input.durationSeconds !== undefined) {
        facts.push(`尺: ${input.durationSeconds} 秒`);
    }
    if (input.width !== undefined && input.height !== undefined) {
        facts.push(`画角: ${input.width}×${input.height}`);
    }
    if (input.fps !== undefined) {
        facts.push(`fps: ${input.fps}`);
    }
    if (input.bytes !== undefined) {
        facts.push(`容量: ${input.bytes} bytes`);
    }
    if (input.engine !== undefined) {
        facts.push(`エンジン: ${input.engine}`);
    }
    return [
        '【パートナーへの依頼】',
        'この動画を確認して、投稿文（X / YouTube 用）とサムネ案と切り抜き候補を提案してください。',
        '【動画の事実】',
        ...facts
    ].join('\n');
}

export interface CopyArtifactCommand {
    readonly command: string;
    readonly args: readonly string[];
}

export function copyArtifactCommand(
    platform: NodeJS.Platform,
    artifactPath: string
): CopyArtifactCommand | undefined {
    if (platform === 'darwin') {
        return { command: 'osascript', args: ['-e', `set the clipboard to POSIX file "${artifactPath}"`] };
    }
    if (platform === 'win32') {
        return { command: 'powershell', args: ['-NoProfile', '-Command', `Set-Clipboard -Path '${artifactPath}'`] };
    }
    if (platform === 'linux') {
        return { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'text/uri-list'] };
    }
    return undefined;
}

export function copyArtifactStdin(platform: NodeJS.Platform, artifactPath: string): string | undefined {
    return platform === 'linux' ? `file://${artifactPath}\n` : undefined;
}
