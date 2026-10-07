import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { materialImageRepeatCount, materialStripCells } from '../common/materials-view';

export interface MaterialStripEntry {
    kind: string;
    durationSeconds?: number;
    thumbnailUri?: URI;
    stripUri?: URI;
}

export function MaterialStrip({ entry, width }: { entry: MaterialStripEntry; width: number | string }): React.ReactNode {
    const cells = entry.kind === 'image' ? materialImageRepeatCount() : materialStripCells(entry.durationSeconds);
    const image = entry.stripUri ?? entry.thumbnailUri;
    const repeated = entry.kind === 'image' && entry.thumbnailUri;
    return <div aria-hidden='true' style={{ position: 'absolute', inset: 0, width, overflow: 'hidden', background: entry.kind === 'audio' ? '#0b1a10' : '#000' }}>
        {repeated ? Array.from({ length: cells }, (_, index) =>
            <img key={index} src={entry.thumbnailUri!.toString()} alt='' draggable={false}
                style={{ position: 'absolute', left: `${index * 100 / cells}%`, top: 0, width: `${100 / cells}%`, height: '100%',
                    objectFit: 'cover', objectPosition: 'left center', borderLeft: index ? '1px solid rgba(0,0,0,.5)' : undefined }} />)
            : image && <img src={image.toString()} alt='' draggable={false} style={{ position: 'absolute', left: 0, top: 0,
                width: entry.stripUri ? '100%' : 'auto', maxWidth: entry.stripUri ? undefined : `${100 / cells}%`,
                // 帯（cells × cellWidth の 1 枚）は行の幅に伸縮させて「最初から最後まで」を出す（cover だと行幅 < 帯幅のとき右側が欠ける）。
                // strip 未着の 1 コマだけ cover で左に置く。
                height: '100%', objectFit: entry.stripUri ? 'fill' : 'cover', objectPosition: 'left center' }} />}
        {entry.kind === 'video' && entry.stripUri && Array.from({ length: cells - 1 }, (_, index) =>
            <span key={index} style={{ position: 'absolute', left: `${(index + 1) * 100 / cells}%`, top: 0,
                width: '1px', height: '100%', background: 'rgba(0,0,0,.5)' }} />)}
    </div>;
}
