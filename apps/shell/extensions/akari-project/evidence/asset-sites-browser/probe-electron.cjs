// Isolated local-only measurement of the three embedding strategies.
const { app, BrowserWindow, WebContentsView } = require('electron');
const mode = process.argv[2];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 650, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: mode === 'b' } });
  await window.loadURL('data:text/html,<body style="margin:0"><div id="layout" style="display:flex;height:100vh"><div id="slot" style="width:100%;height:100%"></div><div id="other" style="display:none;width:50%"></div></div></body>');
  const result = { mode, steps: {} };
  if (mode === 'a') {
    const view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.contentView.addChildView(view);
    await view.webContents.loadURL('data:text/html,<h1>probe A</h1>');
    const measure = async () => {
      const slot = await window.webContents.executeJavaScript('document.querySelector("#slot").getBoundingClientRect().toJSON()');
      view.setBounds({ x: Math.floor(slot.x), y: Math.floor(slot.y), width: Math.floor(slot.width), height: Math.floor(slot.height) });
      return { widgetRect: rect(slot), viewBounds: view.getBounds(), windowBounds: window.getBounds() };
    };
    result.steps.initial = await measure();
    await window.webContents.executeJavaScript('document.querySelector("#slot").style.display="none"');
    result.steps.tabHidden = await measure();
    await window.webContents.executeJavaScript('document.querySelector("#slot").style.display="block";document.querySelector("#slot").style.width="50%";document.querySelector("#other").style.display="block"');
    result.steps.split = await measure();
    window.setSize(1040, 740); await pause(150); result.steps.resize = await measure();
    const before = window.getBounds(); window.setPosition(before.x + 35, before.y + 25); await pause(150);
    result.steps.move = await measure();
    view.webContents.close();
  } else if (mode === 'b') {
    await window.webContents.executeJavaScript(`document.querySelector('#slot').innerHTML = '<webview src="data:text/html,%3Ch1%3Eprobe%20B%3C%2Fh1%3E" style="display:block;width:100%;height:100%"></webview>'`);
    await window.webContents.executeJavaScript(`new Promise(resolve => { const el = document.querySelector('webview');
      if (el.getWebContentsId?.()) resolve(); else { el.addEventListener('did-attach', resolve, { once: true }); setTimeout(resolve, 3000); } })`);
    const measure = async () => ({ ...await window.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('webview'), slot = document.querySelector('#slot');
      return { attached: !!el.getWebContentsId?.(), widgetRect: slot.getBoundingClientRect().toJSON(), viewBounds: el.getBoundingClientRect().toJSON() };
    })()`), windowBounds: window.getBounds() });
    result.steps.initial = await measure();
    await window.webContents.executeJavaScript('document.querySelector("#slot").style.display="none"');
    result.steps.tabHidden = await measure();
    await window.webContents.executeJavaScript('document.querySelector("#slot").style.display="block";document.querySelector("#slot").style.width="50%";document.querySelector("#other").style.display="block"');
    result.steps.split = await measure();
    window.setSize(1040, 740); await pause(150); result.steps.resize = await measure();
    const before = window.getBounds(); window.setPosition(before.x + 35, before.y + 25); await pause(150);
    result.steps.move = await measure();
  } else if (mode === 'c') {
    const child = new BrowserWindow({ parent: window, width: 400, height: 300, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await child.loadURL('data:text/html,<h1>probe C</h1>');
    const parent = window.getBounds(); child.setBounds({ x: parent.x + 50, y: parent.y + 70, width: 400, height: 300 });
    const measure = () => ({ parentBounds: window.getBounds(), childBounds: child.getBounds(), childVisible: child.isVisible(),
      offset: { x: child.getBounds().x - window.getBounds().x, y: child.getBounds().y - window.getBounds().y } });
    result.steps.initial = measure();
    child.hide(); result.steps.tabHidden = measure();
    child.showInactive(); child.setBounds({ x: parent.x + 450, y: parent.y + 70, width: 400, height: 300 });
    result.steps.split = measure();
    window.setSize(1040, 740); await pause(150); result.steps.resize = measure();
    window.setPosition(parent.x + 35, parent.y + 25); await pause(150); result.steps.move = measure();
    child.close();
  } else throw new Error(`unknown mode: ${mode}`);
  if (mode === 'b') {
    const sameRect = step => ['x', 'y', 'width', 'height'].every(key =>
      Math.abs(step.widgetRect[key] - step.viewBounds[key]) <= 1);
    result.checks = {
      attached: Object.values(result.steps).every(step => step.attached),
      tabHidden: result.steps.tabHidden.viewBounds.width === 0,
      splitMatches: sameRect(result.steps.split) && result.steps.split.widgetRect.width < result.steps.initial.widgetRect.width,
      resizeMatches: sameRect(result.steps.resize) && result.steps.resize.windowBounds.width > result.steps.split.windowBounds.width,
      moveMatches: sameRect(result.steps.move) && result.steps.move.windowBounds.x !== result.steps.resize.windowBounds.x
    };
  }
  if (mode === 'c') result.checks = {
    tabHidden: !result.steps.tabHidden.childVisible,
    splitOffset: result.steps.split.offset.x > result.steps.initial.offset.x,
    resizeRetainedOffset: result.steps.resize.offset.x === result.steps.split.offset.x,
    moveRetainedOffset: result.steps.move.offset.x === result.steps.resize.offset.x
      && result.steps.move.offset.y === result.steps.resize.offset.y
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  app.quit();
}).catch(error => { console.error(error); app.quit(); process.exitCode = 1; });
