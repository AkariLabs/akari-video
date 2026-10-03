import { Disposable } from '@theia/core/lib/common/disposable';

/** target に購読を登録し、同じ type / handler / capture で解除する Disposable を返す。 */
export function listen<E extends Event = Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: boolean | AddEventListenerOptions
): Disposable {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    return Disposable.create(() => target.removeEventListener(type, listener, options));
}
