export const ATTACHABLE_TARGET_TYPES = new Set(['iframe', 'webview', 'page']);

export function shouldAttachTarget(info, mainTargetId, attemptedTargetIds, attachedTargetIds) {
  if (!info?.targetId || info.targetId === mainTargetId) return false;
  if (!ATTACHABLE_TARGET_TYPES.has(info.type)) return false;
  if (attemptedTargetIds.has(info.targetId) || attachedTargetIds.has(info.targetId)) return false;
  return true;
}

export function assertTargetAttachPolicy() {
  const mainTargetId = 'main-page';
  const attempted = new Set();
  const attached = new Set();
  const checks = {
    mainPageExcluded: !shouldAttachTarget(
      { targetId: mainTargetId, type: 'page' }, mainTargetId, attempted, attached
    ),
    browserExcluded: !shouldAttachTarget(
      { targetId: 'browser', type: 'browser' }, mainTargetId, attempted, attached
    ),
    serviceWorkerExcluded: !shouldAttachTarget(
      { targetId: 'worker', type: 'service_worker' }, mainTargetId, attempted, attached
    ),
    iframeAccepted: shouldAttachTarget(
      { targetId: 'frame', type: 'iframe' }, mainTargetId, attempted, attached
    ),
    webviewAccepted: shouldAttachTarget(
      { targetId: 'view', type: 'webview' }, mainTargetId, attempted, attached
    ),
    secondaryPageAccepted: shouldAttachTarget(
      { targetId: 'secondary-page', type: 'page' }, mainTargetId, attempted, attached
    )
  };
  attempted.add('frame');
  checks.attemptedTargetRejected = !shouldAttachTarget(
    { targetId: 'frame', type: 'iframe' }, mainTargetId, attempted, attached
  );
  attached.add('view');
  checks.attachedTargetRejected = !shouldAttachTarget(
    { targetId: 'view', type: 'webview' }, mainTargetId, attempted, attached
  );
  if (Object.values(checks).some(value => value !== true)) {
    throw new Error(`target attach policy self-check failed: ${JSON.stringify(checks)}`);
  }
  return checks;
}
