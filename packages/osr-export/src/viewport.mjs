export function viewportMatches(requested, measured) {
  return Number(measured?.width) === Number(requested?.width)
    && Number(measured?.height) === Number(requested?.height)
    && Number(measured?.devicePixelRatio ?? 1) === 1;
}

export function deviceEmulationParameters({ width, height }) {
  return {
    screenPosition: "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width, height },
    deviceScaleFactor: 1,
    scale: 1,
  };
}

export const VIEWPORT_SETTLE_TIMEOUT_MS = 2_000;

// Runs inside the page. The function text is injected with String and must remain unchanged.
export const PAGE_VIEWPORT_PROBE = String((expected, timeoutMs) => new Promise((resolve) => {
  const read = () => [window.innerWidth, window.innerHeight, window.devicePixelRatio];
  const matches = () => expected !== null
    && window.innerWidth === expected.width && window.innerHeight === expected.height && window.devicePixelRatio === 1;
  if (expected === null || timeoutMs <= 0 || matches()) { resolve(read()); return; }
  const started = performance.now();
  let timer = null;
  const finish = () => { window.removeEventListener("resize", check); clearInterval(timer); resolve(read()); };
  const check = () => { if (matches() || performance.now() - started >= timeoutMs) finish(); };
  window.addEventListener("resize", check);
  timer = setInterval(check, 50);
}));

export async function measurePageViewport(webContents, { expected = null, timeoutMs = 0 } = {}) {
  const [width, height, devicePixelRatio] = await webContents.executeJavaScript(
    `(${PAGE_VIEWPORT_PROBE})(${JSON.stringify(expected)}, ${Number(timeoutMs)})`,
  );
  return { width, height, devicePixelRatio };
}
