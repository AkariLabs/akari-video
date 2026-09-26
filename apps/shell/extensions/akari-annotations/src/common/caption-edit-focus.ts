export function captionEditFocusWithinMarkedWidget(
    focused: Node | null | undefined,
    markedWidgets: readonly Pick<Node, 'contains'>[]
): boolean {
    return !!focused && markedWidgets.some(widget => widget.contains(focused));
}
