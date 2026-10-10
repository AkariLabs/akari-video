import * as React from '@theia/core/shared/react';

export interface ConnectStackItem { id: string; icon: string; name: string; }
export function ConnectStack({ items, limit = 5 }: { items: readonly ConnectStackItem[]; limit?: number }): React.ReactElement {
    const visible = items.slice(0, limit);
    return <span className="akari-connect-stack" aria-label={items.length ? `接続中: ${items.map(item => item.name).join('、')}` : '接続中の項目なし'}>
        {visible.map(item => <span className="akari-connect-stack-icon" title={item.name} key={item.id}>{item.icon}</span>)}
        {items.length > limit && <span className="akari-connect-stack-more">+{items.length - limit}</span>}
    </span>;
}
