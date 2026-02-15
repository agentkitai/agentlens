import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createAgentLensRelayService } from "./service.js";

const plugin = {
  id: "agentlens-relay",
  name: "AgentLens Relay",
  description: "Full OpenClaw telemetry relay to AgentLens — diagnostic events + prompt capture",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerService(createAgentLensRelayService());
  },
};

export default plugin;
