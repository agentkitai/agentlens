/**
 * LLM Provider Interface (Story 18.1)
 */

export interface LLMCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCompletionResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}
