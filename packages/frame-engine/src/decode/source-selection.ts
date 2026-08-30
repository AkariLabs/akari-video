export type SourceSelectionMode = 'auto' | 'proxy' | 'original';

export interface SourceSelectionInput {
  mode: SourceSelectionMode;
  /** 宣言済み proxy（または既存のフォールバック proxy）が実在するか */
  hasProxy: boolean;
  /** codec プローブ結果。未プローブ / 取得失敗は null | undefined */
  support?: { hw: boolean; sw: boolean; any: boolean; codec?: string } | null;
}

export interface SourceSelectionDecision {
  chosen: 'original' | 'proxy' | 'auto-proxy';
  reason: 'declared' | 'preference:proxy' | 'probe-unavailable'
    | 'hardware-ok' | 'decoder-ok' | 'codec-unsupported' | 'auto-proxy';
}

/** 実力判定（= Range で moov を取る codec プローブ）が要るか。宣言 proxy を既定で使う場合は不要。 */
export function needsCodecProbe(mode: SourceSelectionMode, hasProxy: boolean): boolean {
  return !(mode === 'proxy' || (mode !== 'original' && hasProxy));
}

/** 選択順の唯一の実装。 */
export function chooseSource(input: SourceSelectionInput): SourceSelectionDecision {
  const { mode, hasProxy, support } = input;
  if (mode === 'proxy') {
    return { chosen: hasProxy ? 'proxy' : 'original', reason: 'preference:proxy' };
  }
  if (mode !== 'original' && hasProxy) {
    return { chosen: 'proxy', reason: 'declared' };
  }
  if (support == null) {
    return { chosen: 'original', reason: 'probe-unavailable' };
  }
  if (support.hw) {
    return { chosen: 'original', reason: 'hardware-ok' };
  }
  if (support.any) {
    return { chosen: 'original', reason: 'decoder-ok' };
  }
  if (hasProxy) {
    return { chosen: 'proxy', reason: 'codec-unsupported' };
  }
  return { chosen: 'auto-proxy', reason: 'auto-proxy' };
}

/** 'proxy' | 'original' | それ以外 = 'auto' へ正規化（大小文字・前後空白を無視）。 */
export function parseSourceSelectionMode(value: unknown): SourceSelectionMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'proxy' || normalized === 'original' ? normalized : 'auto';
}
