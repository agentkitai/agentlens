import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createAgentLensRelayService } from "./service.js";

const plugin = {
  id: "agentlens-relay",
  name: "AgentLens Relay",
  description: "Captures Anthropic API calls and relays telemetry to AgentLens",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerService(createAgentLensRelayService());
  },
};

export default plugin;
