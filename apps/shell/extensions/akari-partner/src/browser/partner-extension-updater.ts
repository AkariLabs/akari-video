import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import { VSXRegistryService } from '@theia/vsx-registry/lib/common/vsx-registry-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-identifiers';
import { VSCodeExtensionUri } from '@theia/plugin-ext-vscode/lib/common/plugin-vscode-uri';
import { decideExtensionUpdate, ExtensionFreshnessReason, formatExtensionUpdateNotice } from '../common/extension-freshness';
import { PARTNER_CATALOG, PartnerExtensionCatalogEntry } from './partner-catalog';

export interface ExtensionUpdateOutcome {
    kind: 'up-to-date' | 'updated' | 'skipped' | 'failed';
    reason: ExtensionFreshnessReason | 'install-failed' | 'uninstall-failed';
    installedVersion?: string;
    latestVersion?: string;
    needsReload: boolean;
    detail: string;
}

@injectable()
export class PartnerExtensionUpdater {
    @inject(VSXExtensionsModel)
    protected readonly extensionsModel!: VSXExtensionsModel;

    @inject(VSXRegistryService)
    protected readonly vsxRegistryService!: VSXRegistryService;

    @inject(ApplicationServer)
    protected readonly applicationServer!: ApplicationServer;

    @inject(PluginServer)
    protected readonly pluginServer!: PluginServer;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(WindowService)
    protected readonly windowService!: WindowService;

    protected readonly inFlight = new Map<string, Promise<ExtensionUpdateOutcome>>();
    protected startupCheck?: Promise<void>;

    checkAndUpdate(entry: PartnerExtensionCatalogEntry, progress?: (status: string, detail: string) => void): Promise<ExtensionUpdateOutcome> {
        const existing = this.inFlight.get(entry.extensionId);
        if (existing) {
            return existing;
        }
        const check = this.updateExtension(entry, progress).finally(() => this.inFlight.delete(entry.extensionId));
        this.inFlight.set(entry.extensionId, check);
        return check;
    }

    protected async updateExtension(entry: PartnerExtensionCatalogEntry, progress?: (status: string, detail: string) => void): Promise<ExtensionUpdateOutcome> {
        let ext;
        try {
            ext = await this.extensionsModel.resolve(entry.extensionId);
        } catch {
            return { kind: 'skipped', reason: 'registry-unavailable', needsReload: false, detail: '拡張の情報を取得できませんでした' };
        }
        if (!ext.installed) {
            return { kind: 'skipped', reason: 'not-installed', needsReload: false, detail: '拡張は未インストールです' };
        }
        const installed = ext.installedVersion;
        let latest: string | undefined;
        try {
            latest = (await this.vsxRegistryService.findLatestCompatibleExtension({
                extensionId: entry.extensionId,
                includeAllVersions: true,
                targetPlatform: await this.applicationServer.getApplicationPlatform()
            }))?.version;
        } catch {
            // 不通時は現在の拡張をそのまま使う。
        }
        const decision = decideExtensionUpdate({ installedVersion: installed, latestVersion: latest });
        const versions = { installedVersion: installed, latestVersion: latest };
        if (decision.action === 'none') {
            const details: Record<ExtensionFreshnessReason, string> = {
                'not-installed': '拡張は未インストールです',
                'registry-unavailable': '最新の拡張情報を取得できませんでした',
                'unparsable': '拡張のバージョンを比較できませんでした',
                'up-to-date': '拡張は最新です',
                'newer-available': '拡張の更新があります'
            };
            return { ...versions, kind: decision.reason === 'up-to-date' ? 'up-to-date' : 'skipped',
                reason: decision.reason, needsReload: false, detail: details[decision.reason] };
        }
        try {
            progress?.('拡張を更新しています…', `${installed} → ${latest}`);
            await this.pluginServer.install(VSCodeExtensionUri.fromId(entry.extensionId).toString());
            const newId = PluginIdentifiers.idAndVersionToVersionedId({ id: entry.extensionId as PluginIdentifiers.UnversionedId, version: latest! });
            let deployed = false;
            for (let attempt = 0; attempt < 40; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 250));
                // HostedPluginServerImpl.isInstalledPlugin は id をセッション開始時の版にピン留めするため、
                // getDeployedPluginIds() には同一セッション中の新版が現れない（実測 2026-09-05）。
                // 実際の配備を反映する getInstalledPlugins() で新版を確認する。
                if ((await this.pluginServer.getInstalledPlugins()).includes(newId)) {
                    deployed = true;
                    break;
                }
            }
            if (!deployed) {
                return { ...versions, kind: 'failed', reason: 'install-failed', needsReload: false, detail: '新版の配備を確認できませんでした' };
            }
        } catch {
            return { ...versions, kind: 'failed', reason: 'install-failed', needsReload: false, detail: '新版の配備に失敗しました' };
        }
        let reason: ExtensionUpdateOutcome['reason'] = 'newer-available';
        let detail = formatExtensionUpdateNotice(entry.name, installed!, latest!);
        try {
            await this.pluginServer.uninstall(PluginIdentifiers.idAndVersionToVersionedId({ id: entry.extensionId as PluginIdentifiers.UnversionedId, version: installed! }));
        } catch {
            reason = 'uninstall-failed';
            detail += '。旧版の撤去に失敗しました（次回起動では新版が優先されます）';
        }
        console.info('[akari-partner] extension updated', { id: entry.extensionId, from: installed, to: latest });
        return { ...versions, kind: 'updated', reason, needsReload: true, detail };
    }

    checkOnStartup(): Promise<void> {
        this.startupCheck ??= this.runStartupCheck().catch(error => {
            console.warn('[akari-partner] extension freshness check skipped:', String(error).replace(/[\r\n]+/g, ' '));
        });
        return this.startupCheck;
    }

    protected async runStartupCheck(): Promise<void> {
        const notices: string[] = [];
        for (const entry of PARTNER_CATALOG) {
            if (entry.form !== 'extension') {
                continue;
            }
            const outcome = await this.checkAndUpdate(entry);
            if (outcome.kind === 'updated') {
                notices.push(formatExtensionUpdateNotice(entry.name, outcome.installedVersion!, outcome.latestVersion!));
            } else if (outcome.kind === 'failed' || outcome.reason === 'registry-unavailable') {
                console.warn('[akari-partner] extension freshness check skipped:', entry.extensionId, outcome.detail);
            }
        }
        if (notices.length) {
            const choice = await this.messageService.info(notices.join('\n'), '今すぐ再読み込み', '後で');
            if (choice === '今すぐ再読み込み') {
                this.windowService.reload();
            }
        }
    }
}
