const vscode = require('vscode');

// Delay flipping the context key so the view container registers well
// after Theia's onDidInitializeLayout curation pass has already completed —
// reproducing the PoC-observed "extension adds a 5th icon later" scenario
// (contract §5-bis S15).
function activate(context) {
    console.log('[akari-dummy-view-container-fixture] activated, will reveal icon in 2500ms');
    setTimeout(() => {
        vscode.commands.executeCommand('setContext', 'akariDummy.show', true);
        console.log('[akari-dummy-view-container-fixture] akariDummy.show=true (5th icon should now try to appear)');
    }, 2500);
}
function deactivate() {}
module.exports = { activate, deactivate };
