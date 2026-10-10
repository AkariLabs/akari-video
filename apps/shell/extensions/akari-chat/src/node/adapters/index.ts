import type { ChatAdapter } from './adapter';
import { ClaudeStreamJsonAdapter } from './claude-stream-json';
import { AcpAdapter } from './acp';
import { acpAgents } from './acp-agents';

export const chatAdapters: ChatAdapter[] = [
    new ClaudeStreamJsonAdapter(),
    ...acpAgents.map(agent => new AcpAdapter(agent))
];
