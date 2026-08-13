// L1 専用 wrapper: 製品 Electron main をそのまま読み込む前に CDP 観測 hook を登録する。
const path = require('node:path');

const appPath = process.env.AKARI_L1_APP_PATH;
const workspacePath = process.env.AKARI_L1_WORKSPACE_PATH;
process.chdir(appPath);
process.argv = [process.argv[0], appPath, workspacePath, ...process.argv.slice(2).filter(arg => arg.startsWith('--'))];
require('../electron-l1-hook.cjs');
require(path.join(appPath, 'lib/backend/electron-main.js'));
