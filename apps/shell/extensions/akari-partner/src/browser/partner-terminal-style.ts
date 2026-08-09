// akari-* 拡張は tsc -b のみでビルドされ、CSS アセットのコピー工程を
// 持たない。生の CSS import を避け、既存の akari-theme と同じく
// FrontendApplicationContribution から style 要素として注入する。
const CLAUDE_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEwLjkgMS41aDIuMmw0LjIgOC4yIDkuMi0xLjQtLjcgMi4xLTguNSA0LjIgMy45IDguMy0xLjggMS4zLTYuNy02LjUtNi43IDYuNS0xLjgtMS4zIDMuOS04LjMtOC41LTQuMi0uNy0yLjEgOS4yIDEuNHoiLz48L3N2Zz4=';
const CODEX_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDIuNWE0LjUgNC41IDAgMCAxIDQuMTMgMi43MSA0LjUgNC41IDAgMCAxIDQuMjggNy4xNCA0LjUgNC41IDAgMCAxLS4xNSA1IDQuNSA0LjUgMCAwIDEtOC4yNiAxLjY1IDQuNSA0LjUgMCAwIDEtOC4xNC0yLjcxIDQuNSA0LjUgMCAwIDEtLjI3LTcuMTQgNC41IDQuNSAwIDAgMSA4LjQxLTYuNjVabTAgMy41YTggOCAwIDEgMCAwIDE2IDggOCAwIDAgMCAwLTE2Wm0wIDMuMjVhNC43NSA0Ljc1IDAgMSAwIDAgOS41IDQuNzUgNC43NSAwIDAgMCAwLTkuNVoiLz48L3N2Zz4=';
const OPENCODE_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQgNWgxNnYxNEg0em0zIDN2OGgxMFY4eiIvPjwvc3ZnPg==';
const COPILOT_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMgOS41IDYgNWgxMmwzIDQuNVYxOGgtNHYtM0g3djNIM1Y5LjVabTUgMS41YTIgMiAwIDEgMCAwLTQgMiAyIDAgMCAwIDAgNFptOCAwYTIgMiAwIDEgMCAwLTQgMiAyIDAgMCAwIDAgNFoiLz48L3N2Zz4=';
const CURSOR_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQgMi41IDIwIDE0bC03LjIgMS4yTDkgMjIgNCAyLjVabTMuMSA0LjcgMi44IDEwLjkgMS44LTMuMy00LjYtNy42WiIvPjwvc3ZnPg==';
const ANTIGRAVITY_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0ibTEyIDIgMi42IDcuNEwyMiAxMmwtNy40IDIuNkwxMiAyMmwtMi42LTcuNEwyIDEybDcuNC0yLjZMMTIgMlptMCA1LjdMMTAuOCAxMSA3LjcgMTJsMy4xIDEgMS4yIDMuMyAxLjItMy4zIDMuMS0xLTMuMS0xTDEyIDcuN1oiLz48L3N2Zz4=';

export const PARTNER_TERMINAL_CSS = `
.akari-partner-claude-cli-icon,
.akari-partner-codex-cli-icon,
.akari-partner-opencode-cli-icon,
.akari-partner-copilot-cli-icon,
.akari-partner-cursor-cli-icon,
.akari-partner-antigravity-cli-icon {
    display: inline-block;
    width: 16px;
    height: 16px;
    flex: none;
    background-color: currentColor;
    mask-repeat: no-repeat;
    mask-position: 50% 50%;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: 50% 50%;
    -webkit-mask-size: contain;
}
.akari-partner-claude-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${CLAUDE_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${CLAUDE_MARK}");
}
.akari-partner-codex-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${CODEX_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${CODEX_MARK}");
}
.akari-partner-opencode-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${OPENCODE_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${OPENCODE_MARK}");
}
.akari-partner-copilot-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${COPILOT_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${COPILOT_MARK}");
}
.akari-partner-cursor-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${CURSOR_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${CURSOR_MARK}");
}
.akari-partner-antigravity-cli-icon {
    mask-image: url("data:image/svg+xml;base64,${ANTIGRAVITY_MARK}");
    -webkit-mask-image: url("data:image/svg+xml;base64,${ANTIGRAVITY_MARK}");
}
`;

export function installPartnerTerminalStyle(): void {
    if (document.getElementById('akari-partner-terminal-icons')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'akari-partner-terminal-icons';
    style.textContent = PARTNER_TERMINAL_CSS;
    document.head.appendChild(style);
}
