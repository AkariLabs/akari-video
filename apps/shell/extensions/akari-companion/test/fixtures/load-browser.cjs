const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');

exports.load = (relative, overrides = {}) => {
  const filename = path.resolve(__dirname, '../../lib', relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const tokens = new Proxy({}, { get: (_target, name) => name });
  const requireStub = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === '@theia/core/shared/inversify') return { injectable: () => target => target, inject: () => () => {} };
    if (id === '@theia/core/shared/react') return localRequire('react');
    if (id.startsWith('@theia/') || id.startsWith('akari-annotations/')) return tokens;
    return localRequire(id);
  };
  vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireStub, module, module.exports);
  return module.exports;
};
