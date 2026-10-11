const railLampIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0a0a0a" stroke="rgba(255,255,255,.14)"/><circle cx="16" cy="16" r="7" fill="#f97316"/><circle cx="16" cy="16" r="3.4" fill="#fdba74"/></svg>')}`;

const css = `
.lm-TabBar-tabIcon.akari-chat-rail-icon {
  width: 24px !important;
  height: 24px !important;
  background: url("${railLampIcon}") center / contain no-repeat !important;
}
.akari-chat {
  height: 100%;
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
  color: #e5e5e5;
  font: 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
}
.akari-chat * { box-sizing: border-box; }
.akari-chat button {
  cursor: pointer;
  font: inherit;
}
.akari-chat button:disabled {
  cursor: default;
  opacity: .42;
}
.akari-chat-head {
  position: relative;
  z-index: 4;
  height: 46px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid #2b2b2b;
}
.akari-chat-head [data-chat-agent-button] { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; }
.akari-chat-head [data-chat-agent-button] svg { flex: none; }
.akari-chat-head [data-chat-agent-button] span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.akari-chat-head > .akari-chat-spacer { min-width: 0; }
.akari-chat-head > button:not([data-chat-agent-button]) { flex: none; }
.akari-chat-connect-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  flex: none;
  min-height: 34px;
  padding: 6px 14px;
  background: #111 !important;
  color: #bbb !important;
  border: 0 !important;
  border-bottom: 1px solid #292929 !important;
  text-align: left;
}
.akari-chat-connect-row:hover { color: #fff !important; background: #1d1d1d !important; }
.akari-chat-connect-row > span:first-child,
.akari-chat-connect-row > svg { flex: none; }
.akari-chat-connect-row > .akari-chat-spacer { min-width: 0; }
.akari-chat-connect-row .akari-connect-stack { display: inline-flex; align-items: center; min-width: 0; overflow: hidden; }
.akari-chat-connect-row .akari-connect-stack-icon, .akari-chat-connect-row .akari-connect-stack-more {
  display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px;
  border: 1px solid #111; border-radius: 50%; background: #315a65; color: #fff;
  font-size: 10px; font-weight: 700; margin-left: -5px;
}
.akari-chat-connect-row .akari-connect-stack-icon:first-child { margin-left: 0; }
.akari-chat-connect-row .akari-connect-stack-more { width: 22px; }
.akari-chat-spacer { flex: 1; }
.akari-chat-plain {
  border: 0 !important;
  background: transparent !important;
  color: #bbb !important;
  border-radius: 8px;
  padding: 6px 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.akari-chat-plain:hover {
  background: #252525 !important;
  color: #fff !important;
}
.akari-chat-thread {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 18px 25px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.akari-chat-resume {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #a3a3a3;
  font-size: 12px;
  padding: 3px 0 8px;
}
.akari-chat-resume span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akari-chat-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fdba74;
  background: rgba(249, 115, 22, .10);
  border: 2px dashed rgba(249, 115, 22, .55);
  font-size: 15px;
  font-weight: 600;
}
.akari-chat-empty {
  margin: auto;
  text-align: center;
  color: #aaa;
  line-height: 1.7;
}
.akari-chat-empty svg {
  display: block;
  margin: 0 auto 12px;
}
.akari-chat-bubble {
  max-width: 92%;
  line-height: 1.65;
}
.akari-chat-bubble[data-chat-role=user] {
  align-self: flex-end;
  background: #262626;
  border-radius: 16px 16px 4px 16px;
  padding: 10px 14px;
  white-space: pre-wrap;
}
.akari-chat-bubble[data-chat-role=assistant] {
  align-self: flex-start;
  display: flex;
  gap: 10px;
  width: 100%;
}
.akari-chat-avatar {
  width: 27px;
  height: 27px;
  flex: none;
}
.akari-chat-md {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
}
.akari-chat-md p { margin: 0 0 10px; }
.akari-chat-md pre {
  background: #161616;
  padding: 12px;
  border-radius: 9px;
  overflow: auto;
}
.akari-chat-md code {
  font-family: monospace;
  background: #222;
  padding: 1px 3px;
}
.akari-chat-md pre code { background: none; }
.akari-chat-md table {
  border-collapse: collapse;
  display: block;
  overflow: auto;
  margin: 8px 0;
}
.akari-chat-md th, .akari-chat-md td {
  border: 1px solid #424242;
  padding: 7px 10px;
}
.akari-chat-md th { background: #242424; }
.akari-chat-md a { color: #fb923c; }
.akari-chat-tool {
  margin-left: 36px;
  min-width: 0;
  color: #a3a3a3;
}
.akari-chat-tool-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  width: 100%;
  padding: 3px 4px;
  border-radius: 8px;
}
.akari-chat-tool-line:hover { background: #121212; }
.akari-chat-tool-toggle {
  all: unset !important;
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  text-align: left !important;
  gap: 10px !important;
  min-width: 0 !important;
  flex: 1 1 auto !important;
  width: auto !important;
  cursor: pointer !important;
  white-space: nowrap !important;
  color: inherit !important;
}
.akari-chat-tool-icon {
  width: 18px;
  flex: none;
  display: inline-flex;
  justify-content: center;
}
.akari-chat-tool-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akari-chat-tool[data-tool-kind=think] .akari-chat-tool-icon { color: #d8b4fe; }
.akari-chat-tool[data-tool-kind=read] .akari-chat-tool-icon { color: #d4d4d4; }
.akari-chat-tool[data-tool-kind=write] .akari-chat-tool-icon { color: #86efac; }
.akari-chat-tool[data-tool-kind=command] .akari-chat-tool-icon { color: #93c5fd; }
.akari-chat-tool[data-tool-kind=skill] .akari-chat-tool-icon { color: #fdba74; }
.akari-chat-tool[data-tool-kind=web] .akari-chat-tool-icon,
.akari-chat-tool[data-tool-kind=search] .akari-chat-tool-icon { color: #5eead4; }
.akari-chat-tool[data-tool-kind=command] .akari-chat-tool-title {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
}
.akari-chat-inline-chip {
  flex: none;
  max-width: 36%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0 !important;
  background: #202020 !important;
  color: #ccc !important;
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 11px !important;
}
.akari-chat-diff-count {
  flex: none;
  display: flex;
  gap: 5px;
  font: 11px ui-monospace, monospace;
}
.akari-chat-diff-count .added, .akari-chat-diff .added { color: #86efac; }
.akari-chat-diff-count .removed, .akari-chat-diff .removed { color: #fca5a5; }
.akari-chat-tool-duration {
  flex: none;
  margin-left: auto;
  color: #8a8a8a;
  font-size: 11px;
}
.akari-chat-tool-expanded {
  margin: 2px 0 8px 26px;
  padding-left: 12px;
}
.akari-chat-tool-detail {
  white-space: pre-wrap;
  overflow: auto;
  max-height: 280px;
  margin: 0;
  color: #ddd;
  background: #111;
  padding: 8px;
  border-radius: 6px;
  font: 12px/1.5 ui-monospace, monospace;
}
.akari-chat-diff span { display: block; }
.akari-chat-files { margin-left: 36px; }
.akari-chat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #45403a !important;
  background: #25201b !important;
  color: #fdba74 !important;
  border-radius: 8px;
  padding: 5px 8px;
  margin: 3px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akari-chat-chip > svg { flex: none; }
.akari-chat-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.akari-chat-chip [data-chat-attachment-remove] { flex: none; }
.akari-chat-review-chip { white-space: normal; text-align: left; max-width: 100%; }
.akari-chat-review-chip img, .akari-chat-review-frame {
  width: 32px; height: 22px; object-fit: cover; border-radius: 3px; flex: none;
  background: #5d321b; border: 1px solid #ad6634;
}
.akari-chat-review-chip small { display: block; color: #d4d4d4; font-size: 11px; }
.akari-chat-sent-attachments { margin-bottom: 5px; }
.akari-chat-drop-pending {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  margin: 3px;
  padding: 5px 9px;
  border: 1px dashed #6b5542;
  border-radius: 8px;
  color: #fdba74;
  font-size: 12px;
}
.akari-chat-ask {
  margin-left: 36px;
  min-width: 0;
  background: #151515;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 12px;
}
.akari-chat-ask > strong { display: block; overflow-wrap: anywhere; margin-bottom: 6px; }
.akari-chat-ask button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  height: 56px;
  overflow: hidden;
  text-align: left;
  border: 0;
  border-top: 1px solid #333;
  padding: 8px;
  background: transparent;
  color: #ddd;
}
.akari-chat-ask-number { flex: none; align-self: flex-start; line-height: 18px; }
.akari-chat-ask-copy { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 18px; }
.akari-chat-ask-copy > span, .akari-chat-ask-copy small {
  display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.akari-chat-ask-copy small { color: #999; font-size: 11px; }
.akari-chat-error {
  color: #fca5a5;
  padding: 8px 12px;
}
.akari-chat-composer {
  position: relative;
  min-width: 0;
  margin: 8px 12px 16px;
  background: #141414;
  border: 1px solid #383838;
  border-radius: 14px;
  padding: 9px;
}
.akari-chat-screen-recording { position: absolute; right: 8px; top: -31px; color: #fca5a5; background: #351717; border: 1px solid #a33; border-radius: 12px; padding: 3px 9px; font-size: 11px !important; }
.akari-chat-composer textarea {
  display: block;
  width: 100%;
  resize: none;
  min-height: 64px;
  background: transparent;
  border: 0;
  outline: 0;
  color: #eee;
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  padding: 5px;
}
.akari-chat-controls {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: nowrap;
  min-width: 0;
}
.akari-chat-controls [data-chat-model-button],
.akari-chat-controls [data-chat-permission-chip] {
  flex: 0 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding-inline: 4px;
}
.akari-chat-controls [data-chat-permission-chip] { flex-shrink: 1.1; }
.akari-chat-controls .akari-chat-control-label {
  display: block;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akari-chat-controls [data-chat-model-button] .akari-chat-control-label { min-width: 3em; }
.akari-chat-controls [data-chat-permission-chip] .akari-chat-control-label { min-width: 2.5em; }
.akari-chat-controls [data-chat-model-button] svg,
.akari-chat-controls [data-chat-permission-chip] svg,
.akari-chat-controls > button:not([data-chat-model-button]):not([data-chat-permission-chip]) {
  flex-shrink: 0;
}
.akari-chat-controls > .akari-chat-spacer { min-width: 0; }
@container (max-width: 320px) {
  .akari-chat-controls { gap: 2px; }
  .akari-chat-controls [data-chat-model-button],
  .akari-chat-controls [data-chat-permission-chip] { gap: 1px; padding-inline: 2px; }
}
@container (max-width: 280px) {
  .akari-chat-composer { margin-inline: 8px; padding-inline: 7px; }
  .akari-chat-controls { gap: 1px; }
  .akari-chat-controls [data-chat-model-button],
  .akari-chat-controls [data-chat-permission-chip] { gap: 1px; padding-inline: 1px; }
  .akari-chat-controls [data-chat-attach],
  .akari-chat-controls [data-chat-mic] { padding-inline: 4px; }
}
.akari-chat-listening { display: flex; align-items: center; gap: 8px; min-height: 25px; color: #fca5a5; font-size: 12px; }
.akari-chat-wave { width: 26px; height: 16px; border-radius: 3px; flex: none; background: repeating-linear-gradient(90deg, #ef4444 0 2px, transparent 2px 5px); transform-origin: center; }
.akari-chat-mic[data-chat-mic-state=recording] { color: #ef4444 !important; background: #381515 !important; }
.akari-chat-activity-wrap { position: absolute; top: -31px; right: 8px; z-index: 3; }
.akari-chat-composer:has(.akari-chat-screen-recording) .akari-chat-activity-wrap { top: -60px; }
.akari-chat-activity-wrap > button { border: 1px solid #9a491b; color: #fdba74; background: #20150e; border-radius: 15px; padding: 3px 10px; font-size: 11px; }
.akari-chat-activity-list { left: auto; right: 8px; bottom: calc(100% + 34px); width: min(320px, calc(100% - 16px)); max-width: calc(100% - 16px); min-width: 0; padding: 9px; }
.akari-chat-activity-row { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px; }
.akari-chat-activity-row svg { flex: none; }
.akari-chat-activity-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.akari-chat-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f97316 !important;
  color: #160a02 !important;
  border: 0 !important;
  border-radius: 8px;
  min-width: 33px;
  height: 33px;
}
.akari-chat-send[data-chat-stop] {
  background: #262626 !important;
  color: #eee !important;
}
.akari-chat-ring {
  width: 23px;
  height: 23px;
  border-radius: 50%;
  display: inline-block;
  position: relative;
  border: 0;
  cursor: pointer;
  flex: none;
}
.akari-chat-ring:after {
  content: '';
  position: absolute;
  inset: 5px;
  background: #141414;
  border-radius: 50%;
}
.akari-chat-pop {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: #1c1c1c;
  border: 1px solid #444;
  border-radius: 12px;
  box-shadow: 0 14px 30px #000b;
  z-index: 2;
  max-height: 420px;
  overflow: auto;
  min-width: min(260px, 100%);
}
.akari-chat-pop button {
  border: 0 !important;
  background: transparent !important;
  color: #ddd !important;
  text-align: left !important;
  padding: 8px;
  border-radius: 6px;
}
.akari-chat-pop button:hover:not(:disabled) { background: #313131 !important; }
.akari-chat-pop button:disabled { cursor: not-allowed; color: #777 !important; }
.akari-chat-pop small {
  color: #999;
  display: block;
  font-size: 11px;
}
.akari-chat-history {
  top: calc(100% + 6px);
  bottom: auto;
  left: auto;
  right: 10px;
  width: min(340px, calc(100% - 20px));
  padding: 8px;
  max-height: min(420px, 70vh);
}
.akari-chat-history button {
  display: flex !important;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  height: auto !important;
  min-height: 52px !important;
  overflow: hidden;
}
.akari-chat-history-entry { display: flex; align-items: center; border-radius: 7px; }
.akari-chat-history-entry:hover { background: #252525; }
.akari-chat-history-entry > button { flex: 1; min-width: 0; }
.akari-chat-history-entry > button > small { display: flex; align-items: center; gap: 4px; }
.akari-chat-history-entry > input { flex: 1; min-width: 0; height: 30px; padding: 4px 7px; color: #eee; background: #111; border: 1px solid #f97316; border-radius: 5px; font: inherit; }
.akari-chat-history-actions { display: flex; gap: 2px; }
.akari-chat-history-actions button { width: auto; min-height: 0 !important; font-size: 10px; padding: 4px !important; }
.akari-chat-history-title {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}
.akari-chat-history-current { color: #f97316; margin-right: 6px; }
.akari-chat-history button small {
  display: block;
  width: 100%;
  color: #999;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.akari-chat-history-empty { display: block; padding: 12px; color: #999; }
.akari-chat-model-pop {
  display: flex;
  width: min(560px, 100%);
  min-height: 300px;
  overflow: hidden;
}
.akari-chat-attach-menu, .akari-chat-permission-menu { left: auto; right: 0; width: min(340px, 100%); padding: 8px; }
.akari-chat-attach-menu strong, .akari-chat-permission-menu strong { display: block; color: #aaa; font-size: 11px; padding: 7px; }
.akari-chat-attach-menu button, .akari-chat-permission-menu button { display: block; width: 100%; }
.akari-chat-attach-menu button {
  height: auto !important;
  min-height: 32px !important;
  white-space: normal !important;
  line-height: 1.4;
}
.akari-chat-attach-menu button[data-chat-attach-item='record'] {
  display: flex !important;
  align-items: center;
  gap: 8px;
  white-space: nowrap !important;
}
.akari-chat-attach-menu .akari-chat-soon-badge {
  display: inline-flex;
  margin-left: auto;
  padding: 1px 5px;
  border: 1px solid #555;
  border-radius: 4px;
  white-space: nowrap;
}
.akari-chat-permission-menu { max-height: min(420px, calc(100vh - 96px)); overflow-y: auto; }
.akari-chat-permission-menu button {
  display: flex !important;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  height: auto !important;
  min-height: 0 !important;
  padding: 9px 8px !important;
  white-space: normal !important;
  line-height: 1.35;
}
.akari-chat-permission-menu button small {
  width: 100%;
  white-space: normal;
  line-height: 1.45;
}
.akari-chat-permission-menu button:disabled { opacity: .7; }
.akari-chat-commands { bottom: calc(100% + 4px); width: 100%; padding: 8px; overflow-y: auto; }
.akari-chat-commands strong { display: block; color: #999; font-size: 11px; padding: 6px 8px; }
.akari-chat-commands button {
  display: block;
  width: 100%;
  height: auto !important;
  min-height: 0 !important;
  line-height: 1.4;
  white-space: normal !important;
  overflow-wrap: anywhere;
}
.akari-chat-commands button small {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.akari-chat-commands button.selected { background: #3a281d !important; }
.akari-chat-context-pop { left: auto; right: 40px; padding: 12px; width: min(280px, 100%); }
.akari-chat-context-pop > div { padding: 5px 0; font-size: 12px; }
.akari-chat-warming { color: #aaa; font-size: 11px; padding: 0 5px 5px; }
.akari-chat-warming button { margin-left: 8px; padding: 1px 5px; border: 0; background: transparent; color: #bbb; cursor: pointer; font-size: 11px; }
.akari-chat-thinking { color: #aaa; font-size: 12px; }
.akari-chat-thinking button { display: flex; align-items: center; gap: 5px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.akari-chat-thinking-text { margin: 5px 0 0 20px; white-space: pre-wrap; }
.akari-chat-agent-initial { font-size: 12px; font-weight: 700; }
.akari-chat-head .akari-partner-claude-cli-icon,
.akari-chat-head .akari-partner-codex-cli-icon,
.akari-chat-head .akari-partner-opencode-cli-icon,
.akari-chat-head .akari-partner-copilot-cli-icon,
.akari-chat-head .akari-partner-grok-cli-icon,
.akari-chat-head .akari-partner-antigravity-cli-icon { width: 16px; height: 16px; }
.akari-chat-agent-column {
  display: flex;
  flex-direction: column;
  flex: 0 0 50px;
  gap: 5px;
  padding: 8px;
  background: #141414;
  border-right: 1px solid #333;
}
.akari-chat-agent-column button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: #ddd;
}
.akari-chat-agent-column button[data-installed=false] { opacity: .42; }
.akari-chat-starting, .akari-chat-stopped, [data-chat-install-guide] { padding: 12px; color: #aaa; }
.akari-chat-stopped { font-size: 12px; }
.akari-chat-starting button, [data-chat-install-guide] button { margin: 6px; }
[data-chat-next-step] { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
[data-chat-next-step] button { min-height: 36px; min-width: 0; max-width: 100%; margin: 0; white-space: normal; text-align: left; }
.akari-chat-model-column input[data-chat-model-search] { width: 100%; box-sizing: border-box; }
.akari-chat-agent-column button.selected,
.akari-chat-model-column button.selected {
  background: rgba(249, 115, 22, .16) !important;
  color: #fdba74 !important;
}
.akari-chat-model-column {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 10px;
}
.akari-chat-model-column strong {
  display: block;
  font-size: 11px;
  color: #999;
  margin: 8px 5px;
}
.akari-chat-model-column .akari-chat-model-all {
  border-top: 1px solid #3b3b3b;
  margin-top: 12px;
  padding-top: 10px;
}
.akari-chat-model-column > button {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
  height: auto !important;
  min-height: 36px !important;
  padding: 9px 8px !important;
  white-space: normal !important;
  line-height: 1.45;
}
.akari-chat-model-column > button > span { min-width: 0; overflow-wrap: anywhere; }
.akari-chat-model-column > button small { display: block; margin-top: 4px; white-space: normal; line-height: 1.45; overflow-wrap: anywhere; }
.akari-chat-model-column > small { margin: 10px 5px; }
.akari-chat-efforts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid #444;
  border-radius: 8px;
  overflow: hidden;
}
.akari-chat-efforts button {
  min-width: 0;
  padding: 7px 2px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center !important;
  border-radius: 0;
}
`;

export function installChatStyle(): void {
    if (document.getElementById('akari-chat-style')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'akari-chat-style';
    style.textContent = css;
    document.head.appendChild(style);
}
