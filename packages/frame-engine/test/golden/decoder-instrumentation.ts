const decoderInstances: VideoDecoder[] = [];
const NativeVideoDecoder = globalThis.VideoDecoder;

if (NativeVideoDecoder) {
  const TrackedVideoDecoder = new Proxy(NativeVideoDecoder, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(
        target,
        args,
        newTarget === TrackedVideoDecoder ? target : newTarget,
      ) as VideoDecoder;
      decoderInstances.push(instance);
      return instance;
    },
  });
  Object.defineProperty(globalThis, 'VideoDecoder', {
    configurable: true,
    value: TrackedVideoDecoder,
  });
}

Object.defineProperty(globalThis, '__frameEngineDecoderInstances', {
  configurable: true,
  value: decoderInstances,
});
