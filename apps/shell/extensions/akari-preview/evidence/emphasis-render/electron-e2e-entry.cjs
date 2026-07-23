// L1 isolation entry: the production bundle keeps single-instance=true, while evidence runs need
// an independent Electron process even when the owner's normal AKARI Video window is open.
const { app } = require('electron');
app.requestSingleInstanceLock = () => true;
require('../../../../src-gen/backend/electron-main.js');
