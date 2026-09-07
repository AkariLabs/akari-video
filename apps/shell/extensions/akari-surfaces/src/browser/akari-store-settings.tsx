import * as React from '@theia/core/shared/react';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { AkariProjectService, AssetEntitlementsStatus } from 'akari-project/lib/common/akari-project-protocol';
import { StoreConnectionFlowController, StoreConnectionFlowState } from 'akari-project/lib/common/store-connection-flow';
import { storeReconnectRequired } from '../common/store-entitlements-visibility';

export function AkariStoreSettings({ service, windows, refreshKey }: { service: AkariProjectService; windows: WindowService; refreshKey: number }): React.ReactElement {
    const [state, setState] = React.useState<StoreConnectionFlowState>({ connection: { connected: false }, connectionLoading: true, phase: 'idle' });
    const [entitlements, setEntitlements] = React.useState<AssetEntitlementsStatus>('no_credentials');
    const controller = React.useMemo(() => new StoreConnectionFlowController(service, {
        openVerificationUrl: url => windows.openNewWindow(url, { external: true }),
        onChange: setState
    }), [service, windows]);
    React.useEffect(() => {
        void controller.refreshStatus();
        return () => controller.dispose();
    }, [controller, refreshKey]);
    React.useEffect(() => {
        let live = true;
        if (state.connection.connected && state.phase === 'idle') {
            void service.getAssetCatalogView(undefined).then(view => {
                if (live) { setEntitlements(view.entitlementsStatus); }
            }, () => { if (live) { setEntitlements('error'); } });
        }
        return () => { live = false; };
    }, [service, state.connection.connected, state.phase]);
    const reconnect = storeReconnectRequired(state.connection.connected, entitlements);
    const busy = state.phase === 'starting' || state.phase === 'pending';
    const url = (state.connection.url ?? 'https://akari-oss.app/api/store').replace(/\/api\/store\/?$/, '/lab/');
    return <section data-akari-store-settings='true' style={{ borderTop: '1px solid var(--theia-widget-border)', paddingTop: 14, display: 'grid', gap: 10 }}>
        <strong>AKARI Store</strong>
        <p data-akari-store-description='true' style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--theia-descriptionForeground)' }}>
            動画に使える素材や演出パックを探して購入できます。接続すると、購入済みの素材をAKARI Videoで使えます。
        </p>
        <span role='status' style={{ color: 'var(--theia-descriptionForeground)', overflowWrap: 'anywhere' }}>
            {state.connectionLoading ? '接続を確認しています…' : state.phase === 'starting' ? '接続を開始しています…'
                : state.phase === 'pending' ? `ブラウザで承認してください${state.userCode ? ` · 確認コード: ${state.userCode}` : ''}`
                    : reconnect ? '再接続が必要です' : state.connection.connected ? `接続中 · ${state.connection.email ?? state.connection.identifier ?? ''}` : '未接続'}
        </span>
        {state.error && <small role='alert' style={{ color: 'var(--theia-errorForeground)' }}>{state.error}</small>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type='button' className='theia-button secondary' onClick={() => windows.openNewWindow(url, { external: true })}>ストアを開く</button>
            {busy ? <button type='button' className='theia-button secondary' onClick={() => controller.cancel()}>キャンセル</button>
                : (!state.connection.connected || reconnect || state.phase === 'error' || state.phase === 'expired') &&
                <button type='button' className='theia-button main' disabled={state.connectionLoading} onClick={() => void controller.start()}>
                    {reconnect ? '再接続する' : state.phase === 'error' || state.phase === 'expired' ? 'もう一度試す' : '接続する'}
                </button>}
        </div>
    </section>;
}
