import { t } from '../common/partner-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import { AkariPartnerServer } from '../common/akari-partner-protocol';
import { decideExtensionCliPreference } from '../common/extension-cli-alignment';
import { PARTNER_CATALOG, PartnerExtensionCatalogEntry } from './partner-catalog';

export interface ExtensionCliAlignOutcome {
    /** 設定を書き換えたか。書き換えは、拡張が CLI を起動し直す次の再読み込みから効く。 */
    changed: boolean;
    /** 書き換えたときの知らせ。 */
    detail?: string;
}

const UNCHANGED: ExtensionCliAlignOutcome = { changed: false };

/**
 * 拡張に同梱の CLI が AKARI 管理の CLI より古いとき、拡張の設定を管理側の CLI へ向ける。
 * 拡張の配布がプラットフォームによって止まり、CLI 形態では選べる新しいモデルが拡張に出ないのを防ぐ。
 */
@injectable()
export class PartnerExtensionCliAligner {
    @inject(VSXExtensionsModel)
    protected readonly extensionsModel!: VSXExtensionsModel;

    @inject(AkariPartnerServer)
    protected readonly partnerServer!: AkariPartnerServer;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(WindowService)
    protected readonly windowService!: WindowService;

    protected readonly inFlight = new Map<string, Promise<ExtensionCliAlignOutcome>>();
    protected startupAlign?: Promise<void>;

    align(entry: PartnerExtensionCatalogEntry, packagePathAttempts = 20): Promise<ExtensionCliAlignOutcome> {
        const existing = this.inFlight.get(entry.extensionId);
        if (existing) return existing;
        const running = this.alignEntry(entry, packagePathAttempts)
            .catch(error => {
                console.warn('[akari-partner] extension CLI alignment skipped:', entry.extensionId, String(error).replace(/[\r\n]+/g, ' '));
                return UNCHANGED;
            })
            .finally(() => this.inFlight.delete(entry.extensionId));
        this.inFlight.set(entry.extensionId, running);
        return running;
    }

    protected async alignEntry(entry: PartnerExtensionCatalogEntry, packagePathAttempts: number): Promise<ExtensionCliAlignOutcome> {
        const managed = entry.managedCli;
        if (!managed || !managed.platforms.includes(await this.partnerServer.getPlatformKey())) return UNCHANGED;
        let packagePath: string | undefined;
        for (let attempt = 0; attempt < packagePathAttempts && !packagePath; attempt++) {
            const extension = await this.extensionsModel.resolve(entry.extensionId);
            if (!extension.installed) return UNCHANGED;
            packagePath = extension.plugin?.metadata.model.packagePath;
            if (!packagePath) await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!packagePath) return UNCHANGED;
        const alignment = await this.partnerServer.resolveExtensionCli(entry.agent, packagePath);
        await this.preferences.ready;
        const decision = decideExtensionCliPreference(this.preferences.inspect<string>(managed.preference)?.globalValue, alignment);
        if (decision.action === 'keep') return UNCHANGED;
        await this.preferences.set(managed.preference, decision.action === 'set' ? decision.value : undefined, PreferenceScope.User);
        console.info('[akari-partner] extension CLI aligned', {
            id: entry.extensionId, action: decision.action, bundled: alignment.bundledVersion, managed: alignment.managedVersion
        });
        return {
            changed: true,
            detail: decision.action === 'set'
                ? t('partner.partnerPanel.extensionCli.switchedToManagedCliReloadText',
                    { value1: entry.name, value2: alignment.bundledVersion, value3: alignment.managedVersion })
                : t('partner.partnerPanel.extensionCli.switchedToBundledCliReloadText', { value1: entry.name })
        };
    }

    /** 設定を書き換えたときだけ、再読み込みを勧める。勝手には再読み込みしない。 */
    async offerReload(detail: string): Promise<void> {
        const reloadAction = t('partner.partnerPanel.extensionUpdater.reloadAction');
        const choice = await this.messageService.info(detail, { timeout: 0 }, reloadAction, t('partner.partnerPanel.extensionUpdater.laterLabel'));
        if (choice === reloadAction) this.windowService.reload();
    }

    /** 起動時: 導入済みの拡張は起動と同時に CLI を立ち上げるので、開く操作を待たずに合わせる。 */
    alignOnStartup(): Promise<void> {
        this.startupAlign ??= (async () => {
            const changed: string[] = [];
            for (const entry of PARTNER_CATALOG) {
                if (entry.form !== 'extension' || !entry.managedCli) continue;
                // 起動直後は拡張の配備情報がまだ届いていないことがあるので、長めに待つ。
                const outcome = await this.align(entry, 80);
                if (outcome.changed && outcome.detail) changed.push(outcome.detail);
            }
            if (changed.length) await this.offerReload(changed.join('\n'));
        })();
        return this.startupAlign;
    }
}
