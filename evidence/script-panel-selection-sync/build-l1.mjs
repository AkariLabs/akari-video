#!/usr/bin/env node
// Build an isolated GUI verification bundle when optional Windows native addons
// are absent from the dependency tree. This does not change production config.
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { nodeOptions } from '../../apps/shell/gen-esbuild.node.mjs';
import { electronOptions } from '../../apps/shell/gen-esbuild.electron.mjs';

if (await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) {
  process.exit(0);
}

const optionalNative = {
  name: 'l1-optional-windows-native',
  setup(build) {
    build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, args => ({ path: args.path, external: true }));
    build.onResolve({ filter: /^\.\/build\/Release\/keymapping$/ }, () => ({
      path: 'keymapping', namespace: 'l1-keymap-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'l1-keymap-stub' }, () => ({
      contents: `module.exports = {
        getKeyMap: () => ({}), getCurrentKeyboardLayout: () => null,
        onDidChangeKeyboardLayout: () => {}, isISOKeyboard: () => false,
      };`, loader: 'js',
    }));
    build.onResolve({ filter: /^drivelist\/build\/Release\/drivelist\.node$/ }, () => ({
      path: 'drivelist', namespace: 'l1-drive-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'l1-drive-stub' }, () => ({
      contents: 'module.exports = { list: callback => callback(null, []) };', loader: 'js',
    }));
  },
};

await esbuild.build({ ...nodeOptions, plugins: [optionalNative, ...nodeOptions.plugins] });
await esbuild.build(electronOptions);
