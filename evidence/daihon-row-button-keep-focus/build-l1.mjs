#!/usr/bin/env node
// Generate an isolated verification bundle when optional native addons are unavailable.
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) process.exit(0);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = path.join(repo, 'apps/shell');
const require = createRequire(path.join(repo, 'package.json'));
const { ApplicationPackageManager } = require('@theia/application-manager');
const esbuild = require('esbuild');
const manager = new ApplicationPackageManager({ projectPath: shell });
manager.prepareElectron = async () => {};
await manager.generate({ mode: 'production' });
await manager.copy();

const { browserOptions } = await import(pathToFileURL(path.join(shell, 'gen-esbuild.browser.mjs')).href);
const { nodeOptions } = await import(pathToFileURL(path.join(shell, 'gen-esbuild.node.mjs')).href);
const { electronOptions } = await import(pathToFileURL(path.join(shell, 'gen-esbuild.electron.mjs')).href);
process.chdir(shell);
const optionalNative = {
  name: 'l1-optional-windows-native',
  setup(build) {
    build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, args => ({ path: args.path, external: true }));
    build.onResolve({ filter: /^\.\/build\/Release\/keymapping$/ }, () => ({
      path: 'keymapping', namespace: 'l1-keymap-stub'
    }));
    build.onLoad({ filter: /.*/, namespace: 'l1-keymap-stub' }, () => ({
      contents: `module.exports = {
        getKeyMap: () => ({}), getCurrentKeyboardLayout: () => null,
        onDidChangeKeyboardLayout: () => {}, isISOKeyboard: () => false,
      };`, loader: 'js'
    }));
    build.onResolve({ filter: /^drivelist\/build\/Release\/drivelist\.node$/ }, () => ({
      path: 'drivelist', namespace: 'l1-drive-stub'
    }));
    build.onLoad({ filter: /.*/, namespace: 'l1-drive-stub' }, () => ({
      contents: 'module.exports = { list: callback => callback(null, []) };', loader: 'js'
    }));
  }
};
await esbuild.build({ ...browserOptions, absWorkingDir: shell });
await esbuild.build({ ...nodeOptions, absWorkingDir: shell, plugins: [optionalNative, ...nodeOptions.plugins] });
await esbuild.build({ ...electronOptions, absWorkingDir: shell });
