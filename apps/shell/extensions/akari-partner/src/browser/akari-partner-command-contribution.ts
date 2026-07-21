import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { WidgetManager } from '@theia/core/lib/browser';
import { AkariPartnerWidget } from './akari-partner-widget';
import { PARTNER_CATALOG } from './partner-catalog';

/**
 * ホーム v2（task.md 2026-07-21-home-flow）向けの薄いコマンド境界。
 *
 * akari-surfaces の接続ゲート／進め方フォームは、akari-partner の内部実装
 * （AkariPartnerWidget のフィールドや PartnerChannel の型）に直接依存せず、
 * このコマンド 2 本だけを呼ぶ。理由は 2 つ:
 * 1. 拡張間の TypeScript 型 import は `apps/shell/package.json` の
 *    `build:ext`（`tsc -b extensions/akari-shell-strip extensions/akari-surfaces
 *    extensions/akari-project extensions/akari-partner ...`）の並び上、
 *    akari-surfaces が akari-partner より先にビルドされるため、コンパイル時の
 *    型解決が壊れる（ビルド順を変えない限り）。
 * 2. CommandService 経由の呼び出しは Theia の標準的な拡張間連携パターンであり、
 *    どちらの拡張も相手の内部構造を知らずに済む。
 *
 * 「PartnerChannel / 隠しターミナル sendText の最小 DI 公開」という指示は、
 * このコマンド越しに同じ送信経路（`AkariPartnerWidget` が保持する
 * `PartnerChannel#send`）を再利用することで満たす。
 */
export const AkariPartnerCommands = {
    BEGIN_ONBOARDING: {
        id: 'akari.partner.beginOnboarding',
        label: 'AI パートナーに接続する'
    } as Command,
    SEND_TO_PARTNER: {
        id: 'akari.partner.send',
        label: 'パートナーにメッセージを送る'
    } as Command
};

@injectable()
export class AkariPartnerCommandContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariPartnerCommands.BEGIN_ONBOARDING, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                await widget.beginRecommended();
            }
        });
        registry.registerCommand(AkariPartnerCommands.SEND_TO_PARTNER, {
            execute: async (text: unknown) => {
                if (typeof text !== 'string' || !text.trim()) {
                    return false;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                return widget.sendFromExternal(text);
            }
        });
    }
}

// begin() の呼び出し元がカタログの中身を知らなくて済むよう、推奨エントリの
// 選定はここ（コマンド境界）に置く。PARTNER_CATALOG 自体は既存 T4 の資産。
export function recommendedPartnerEntry(): typeof PARTNER_CATALOG[number] | undefined {
    return PARTNER_CATALOG.find(entry => entry.recommended) ?? PARTNER_CATALOG[0];
}
