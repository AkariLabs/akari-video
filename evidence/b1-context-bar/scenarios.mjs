// run-l1.mjs から読む操作の筋書き。BEFORE は「今は何が出るか」だけを記録する。
export default async function scenarios(api) {
  const { scenario, selectItem, chrome, webviewHandles, previewShot, key, readFile: _unused, pb, sleep, readEdit, findItem } = api;
  if (api.label.startsWith('before')) {
    await scenario('shape', async () => {
      await selectItem('shape-a');
      const shot = await previewShot('01-select-shape');
      return { shot, chrome: await chrome(), handles: await webviewHandles() };
    });
    await scenario('line', async () => {
      await selectItem('line');
      const shot = await previewShot('02-select-line');
      return { shot, chrome: await chrome(), handles: await webviewHandles() };
    });
    await scenario('photo', async () => {
      await selectItem('photo-1');
      const shot = await previewShot('03-select-photo');
      return { shot, chrome: await chrome() };
    });
    await scenario('copy', async () => {
      await selectItem('shape-a');
      pb(['pbcopy'], 'before-marker');
      await key('c', 'KeyC', 67, ['meta']);
      await sleep(800);
      const clip = pb(['pbpaste']).stdout ?? '';
      let parsed = null;
      try { parsed = JSON.parse(clip); } catch { /* 文字列のまま */ }
      return { clipboardHead: clip.slice(0, 400), kind: parsed?.kind ?? null, isEditItem: !!parsed?.item };
    });
    await scenario('lockField', async () => {
      const edit = await readEdit();
      return { lockedInEdit: findItem(edit, 'shape-a')?.locked ?? null };
    });
    return;
  }
  const after = await import('./scenarios-after.mjs');
  await after.default(api);
}
