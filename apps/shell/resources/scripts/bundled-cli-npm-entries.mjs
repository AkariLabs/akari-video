/**
 * Runtime npm entries shared by CLI staging and third-party license notices.
 * gpu-export imports @webav/mp4box.js from src/mp4-mux.mjs, so staging into
 * Resources/packages/node_modules remains required for packaged GPU export.
 * ATF rendering is retired: no browser automation or runtime esbuild is needed.
 * esbuild is still required by the shell's Theia build and bundle-frame-engine.mjs;
 * keep its allowScripts / CI approve-scripts entries, but do not stage it for CLIs.
 * Transitive dependencies are resolved by the staging and notice generators.
 */
export const BUNDLED_CLI_NPM_ENTRIES = ['@webav/mp4box.js'];
