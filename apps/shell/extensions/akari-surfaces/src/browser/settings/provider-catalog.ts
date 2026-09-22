import { PROVIDER_BALANCE_SUPPORT } from '../../common/akari-connections-protocol';
import { PROVIDER_LOGOS } from './provider-logos';

/**
 * 接続と API キーの表示用の表（グループ・一言の説明）。並びとラベルの正は credentials-file.ts の formatConnections。
 *
 * 説明文の上書きはここ 1 か所だけ（creator-root の notes.description は工程番号入りの内部向けの文なので、
 * 設定画面では利用者向けの一言に差し替える）。表に無いプロバイダーは creator-root の説明をそのまま出す。
 * OpenRouter はオーナー口述（2026-09-22）「つなぐと Akari Vibe（声で動画編集）が使える」の趣旨。
 */
export type ProviderGroup = 'generate' | 'transcribe';

export const PROVIDER_GROUP_LABELS: Record<ProviderGroup, string> = {
    generate: '生成 AI',
    transcribe: '文字起こし'
};

export const PROVIDER_DISPLAY: Readonly<Record<string, { group: ProviderGroup; description: string; highlight?: string }>> = {
    fal: { group: 'generate', description: '1 つのキーで画像生成・動画生成・文字起こし。既定モデル（静止画 / 動画）もここで選びます' },
    openrouter: {
        group: 'generate', description: 'いろいろな会社の AI モデルを 1 つのキーで。',
        highlight: 'つなぐと Akari Vibe（声で話しかけて動画を編集）が使えます'
    },
    replicate: { group: 'generate', description: '画像・動画・音声のいろいろなモデルを呼び出します' },
    elevenlabs: { group: 'generate', description: 'ナレーション・音声の生成。つなぐと今月の残りクレジットを見られます' },
    groq: { group: 'transcribe', description: '速いクラウド文字起こし。残高を問い合わせる公式の口が無いので、管理画面へのリンクだけ出します' }
};

export function providerGroup(id: string): ProviderGroup {
    return PROVIDER_DISPLAY[id]?.group ?? 'generate';
}

export function providerLogo(id: string): string | undefined {
    return PROVIDER_LOGOS[id];
}

export function providerBillingUrl(id: string): string | undefined {
    return PROVIDER_BALANCE_SUPPORT[id]?.billing_url;
}

/** 頭文字のプレースホルダ（公式ロゴが無いとき）。 */
export function providerInitial(label: string): string {
    return (label.trim()[0] ?? '?').toUpperCase();
}
