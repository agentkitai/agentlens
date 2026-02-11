import { request } from './core';
import type { Agent } from './core';

interface AgentsResponse {
  agents: Agent[];
}

export async function getAgents(): Promise<Agent[]> {
  const data = await request<AgentsResponse>('/api/agents');
  return data.agents;
}

export async function getAgent(id: string): Promise<Agent> {
  return request<Agent>(`/api/agents/${encodeURIComponent(id)}`);
}
