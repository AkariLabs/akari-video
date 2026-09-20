export type FlyToTargetKind =
    'inspectorField' | 'timelineItem' | 'previewItem' | 'daihonRow' | 'catalogCard' | 'menuSection';

/** kind ごとの DOM 属性。previewItem は属性検索を使わない専用経路。 */
export const FLY_TO_ATTRIBUTES: Readonly<Record<FlyToTargetKind, readonly string[]>> = {
    inspectorField: ['data-akari-field'],
    timelineItem: ['data-akari-item-id'],
    daihonRow: ['data-caption-id'],
    menuSection: ['data-akari-menu-section'],
    catalogCard: [
        'data-akari-material-path',
        'data-akari-catalog-item',
        'data-akari-catalog-preset-item',
        'data-akari-library-transition',
        'data-akari-catalog-pack'
    ],
    previewItem: []
};

export function isFlyToTargetKind(value: unknown): value is FlyToTargetKind {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FLY_TO_ATTRIBUTES, value);
}

export function buildFlyToSelector(kind: FlyToTargetKind, id: string, escape: (raw: string) => string): string {
    return FLY_TO_ATTRIBUTES[kind].map(attribute => `[${attribute}="${escape(id)}"]`).join(', ');
}

/** ちょうど 1 件が見えている場合だけ対象として確定する。 */
export function resolveFlyToMatch(matches: ReadonlyArray<{ visible: boolean }>): boolean {
    return matches.length === 1 && matches[0].visible;
}
