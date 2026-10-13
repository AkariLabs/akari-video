import * as path from 'path';
import { PartnerAgentId } from '../common/akari-partner-protocol';
import { decideExtensionCliAlignment, ExtensionCliAlignment } from '../common/extension-cli-alignment';
import { extractCliVersion } from '../common/partner-cli-freshness';
import { partnerCliCandidates } from './partner-cli-candidates';

export interface ExtensionCliProbe {
    platform: NodeJS.Platform;
    arch: string;
    homeDir: string;
    env: NodeJS.ProcessEnv;
    listDirectory(directory: string): Promise<string[]>;
    isFile(file: string): Promise<boolean>;
    readText(file: string): Promise<string | undefined>;
    /** `--version` の出力。実行できなければ undefined。 */
    readVersionOutput(executable: string): Promise<string | undefined>;
}

const PLATFORM_TOKENS: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: ['windows', 'win32'], darwin: ['macos', 'darwin', 'apple'], linux: ['linux']
};
const ARCH_TOKENS: Record<string, string[]> = { x64: ['x86_64', 'x64'], arm64: ['aarch64', 'arm64'] };

/** 拡張に同梱の CLI と AKARI 管理の CLI の版を調べ、拡張に管理側を使わせるかを返す。決して throw しない。 */
export async function resolveExtensionCli(agent: PartnerAgentId, packagePath: string, probe: ExtensionCliProbe): Promise<ExtensionCliAlignment> {
    if (agent !== 'codex' || !packagePath) return { reason: 'unsupported', managedPaths: [] };
    // PATH は見ない。利用者が別に入れた CLI ではなく、AKARI が導入・更新する置き場だけを対象にする。
    const managedPaths = partnerCliCandidates(agent, {
        homeDir: probe.homeDir, platform: probe.platform, env: probe.env, includePath: false, nativeOnly: true
    });
    try {
        let managedExecutablePath: string | undefined;
        for (const candidate of managedPaths) {
            if (await probe.isFile(candidate)) { managedExecutablePath = candidate; break; }
        }
        const managedVersion = managedExecutablePath
            ? extractCliVersion(await probe.readVersionOutput(managedExecutablePath)) : undefined;
        const bundledVersion = managedExecutablePath ? await bundledCliVersion(packagePath, probe) : undefined;
        return decideExtensionCliAlignment({ bundledVersion, managedVersion, managedExecutablePath, managedPaths });
    } catch {
        return { reason: 'unknown-bundled-version', managedPaths };
    }
}

async function bundledCliVersion(packagePath: string, probe: ExtensionCliProbe): Promise<string | undefined> {
    const binDirectory = path.join(packagePath, 'bin');
    const platformTokens = PLATFORM_TOKENS[probe.platform] ?? [];
    const archTokens = ARCH_TOKENS[probe.arch] ?? [];
    const matches = (await probe.listDirectory(binDirectory)).filter(name => {
        const lower = name.toLowerCase();
        return platformTokens.some(token => lower.includes(token)) && archTokens.some(token => lower.includes(token));
    });
    // どれが使われるか決めきれない構成では比べない（設定を書き換えない側へ倒す）。
    if (matches.length !== 1) return undefined;
    const directory = path.join(binDirectory, matches[0]);
    const manifest = await probe.readText(path.join(directory, 'codex-package.json'));
    if (manifest) {
        try {
            const version = extractCliVersion(String((JSON.parse(manifest) as { version?: unknown }).version ?? ''));
            if (version) return version;
        } catch { /* 読めない同梱情報は実行ファイルに尋ねる。 */ }
    }
    const executable = path.join(directory, probe.platform === 'win32' ? 'codex.exe' : 'codex');
    return await probe.isFile(executable) ? extractCliVersion(await probe.readVersionOutput(executable)) : undefined;
}
