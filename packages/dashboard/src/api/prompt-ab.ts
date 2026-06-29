/**
 * Prompt A/B testing (#150) — client over the prompt A/B endpoints.
 */
import { request } from './core';

export interface AbVariant {
  versionId: string;
  label: string;
  weight: number;
}

export interface AbTest {
  id: string;
  templateId: string;
  environment: string;
  variants: AbVariant[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function listAbTests(templateId: string): Promise<{ abTests: AbTest[] }> {
  return request(`/api/prompts/${encodeURIComponent(templateId)}/ab`);
}

export function startAbTest(templateId: string, environment: string, variants: AbVariant[]): Promise<{ abTest: AbTest }> {
  return request(`/api/prompts/${encodeURIComponent(templateId)}/ab`, {
    method: 'POST',
    body: JSON.stringify({ environment, variants }),
  });
}

export function stopAbTest(templateId: string, abId: string): Promise<{ ok: boolean }> {
  return request(`/api/prompts/${encodeURIComponent(templateId)}/ab/${encodeURIComponent(abId)}`, { method: 'DELETE' });
}
