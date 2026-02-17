import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { registerAgentLensHooks } from "./service.js";

const plugin = {
  id: "agentlens-relay",
  name: "AgentLens Relay",
  description: "Captures LLM calls and delegations via hooks and relays telemetry to AgentLens",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    registerAgentLensHooks(api);
  },
};

export default plugin;
