/**
 * Prompt runtime primitives (#145): {{variable}} compilation, chat prompt type,
 * and per-prompt config. Pure + shared by the SDK and the server so a stored
 * prompt compiles to a ready-to-send request identically on both sides.
 */
import type { PromptVariable } from './types.js';

export type PromptType = 'text' | 'chat';

export interface ChatMessage {
  role: string;
  content: string;
}

/** Model/runtime config carried with a prompt version (sent alongside the compiled body). */
export interface PromptConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: unknown[];
  responseFormat?: unknown;
  [key: string]: unknown;
}

export type VariableValues = Record<string, string | number | boolean | null | undefined>;

export interface CompiledPrompt {
  type: PromptType;
  /** Present for text prompts. */
  text?: string;
  /** Present for chat prompts. */
  messages?: ChatMessage[];
  config?: PromptConfig;
  /** Referenced variables with no provided value and no default — must be filled before sending. */
  missing: string[];
}

// {{name}} or {{ name }} — names are word chars, dot, or dash.
const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** All distinct variable names referenced in a template (deduped, in first-seen order). */
export function extractVariables(template: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) {
    if (!seen.has(m[1]!)) {
      seen.add(m[1]!);
      names.push(m[1]!);
    }
  }
  return names;
}

function declMap(variables?: PromptVariable[]): Map<string, PromptVariable> {
  const m = new Map<string, PromptVariable>();
  for (const v of variables ?? []) m.set(v.name, v);
  return m;
}

function substitute(template: string, values: VariableValues, decls: Map<string, PromptVariable>, missing: Set<string>): string {
  return template.replace(VAR_RE, (_full, name: string) => {
    const v = values[name];
    if (v !== undefined && v !== null) return String(v);
    const def = decls.get(name)?.defaultValue;
    if (def !== undefined) return def;
    missing.add(name); // unresolved — left as a literal placeholder
    return `{{${name}}}`;
  });
}

/** Compile a text template: substitute variables, apply declared defaults, collect unresolved. */
export function compileText(template: string, values: VariableValues = {}, variables?: PromptVariable[]): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = substitute(template, values, declMap(variables), missing);
  return { text, missing: [...missing] };
}

/** Compile a chat prompt: substitute variables in every message's content. */
export function compileChat(messages: ChatMessage[], values: VariableValues = {}, variables?: PromptVariable[]): { messages: ChatMessage[]; missing: string[] } {
  const missing = new Set<string>();
  const decls = declMap(variables);
  const out = messages.map((m) => ({ role: m.role, content: substitute(m.content, values, decls, missing) }));
  return { messages: out, missing: [...missing] };
}

export interface CompilablePrompt {
  type?: PromptType;
  /** Text template (type='text') or chat messages (type='chat'). */
  content: string | ChatMessage[];
  variables?: PromptVariable[];
  config?: PromptConfig;
}

/** Compile a stored prompt (text or chat) into a ready-to-send request. */
export function compilePrompt(prompt: CompilablePrompt, values: VariableValues = {}): CompiledPrompt {
  const type: PromptType = prompt.type ?? (Array.isArray(prompt.content) ? 'chat' : 'text');
  if (type === 'chat') {
    const messages = Array.isArray(prompt.content)
      ? prompt.content
      : (JSON.parse(prompt.content) as ChatMessage[]);
    const r = compileChat(messages, values, prompt.variables);
    return { type, messages: r.messages, config: prompt.config, missing: r.missing };
  }
  const template = Array.isArray(prompt.content) ? prompt.content.map((m) => m.content).join('\n') : prompt.content;
  const r = compileText(template, values, prompt.variables);
  return { type, text: r.text, config: prompt.config, missing: r.missing };
}
