// akari-* 拡張は tsc -b のみでビルドされ、CSS アセットのコピー工程を
// 持たない。生の CSS import を避け、既存の akari-theme と同じく
// FrontendApplicationContribution から style 要素として注入する。
const CLAUDE_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEwLjkgMS41aDIuMmw0LjIgOC4yIDkuMi0xLjQtLjcgMi4xLTguNSA0LjIgMy45IDguMy0xLjggMS4zLTYuNy02LjUtNi43IDYuNS0xLjgtMS4zIDMuOS04LjMtOC41LTQuMi0uNy0yLjEgOS4yIDEuNHoiLz48L3N2Zz4=';
const CODEX_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDIuNWE0LjUgNC41IDAgMCAxIDQuMTMgMi43MSA0LjUgNC41IDAgMCAxIDQuMjggNy4xNCA0LjUgNC41IDAgMCAxLS4xNSA1IDQuNSA0LjUgMCAwIDEtOC4yNiAxLjY1IDQuNSA0LjUgMCAwIDEtOC4xNC0yLjcxIDQuNSA0LjUgMCAwIDEtLjI3LTcuMTQgNC41IDQuNSAwIDAgMSA4LjQxLTYuNjVabTAgMy41YTggOCAwIDEgMCAwIDE2IDggOCAwIDAgMCAwLTE2Wm0wIDMuMjVhNC43NSA0Ljc1IDAgMSAwIDAgOS41IDQuNzUgNC43NSAwIDAgMCAwLTkuNVoiLz48L3N2Zz4=';
const OPENCODE_MARK = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQgNWgxNnYxNEg0em0zIDN2OGgxMFY4eiIvPjwvc3ZnPg==';

export const PARTNER_TERMINAL_CSS = `
.akari-partner-claude-cli-icon,
.akari-partner-codex-cli-icon,
.akari-partner-opencode-cli-icon {
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
