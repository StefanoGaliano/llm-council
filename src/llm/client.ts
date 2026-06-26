/**
 * Anthropic client wrapper: a single `complete()` surface with streaming and
 * prompt-caching (`cache_control`) support. The underlying SDK is injected via
 * an `LlmBackend` so tests mock the network boundary (never call Anthropic in tests).
 */

import Anthropic from '@anthropic-ai/sdk';
import { type ModelId } from '@/config/models';
import { normalizeUsage, toTurnUsage, type RawUsage } from '@/llm/cost';
import type { TurnUsage } from '@/types';

// ── Wire shapes (narrow subset of the Messages API we actually use) ──────────

export interface CacheControl {
  type: 'ephemeral';
  ttl?: '1h';
}

export interface TextBlockParam {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | { type: string };

/** A content block on a message: a typed text block, or any other wire block. */
export type ContentBlockParam = TextBlockParam | ({ type: string } & Record<string, unknown>);

export interface MessageParam {
  role: 'user' | 'assistant';
  content: string | ContentBlockParam[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolChoice = { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };

export interface CreateBody {
  model: ModelId;
  max_tokens: number;
  system?: string | TextBlockParam[];
  messages: MessageParam[];
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
}

export interface LlmResponse {
  content: ContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

/** The injectable network boundary. The real impl wraps `@anthropic-ai/sdk`. */
export interface LlmBackend {
  create(body: CreateBody): Promise<LlmResponse>;
}

// ── Public request/result types ──────────────────────────────────────────────

export interface CompleteParams {
  model: ModelId;
  system?: string | TextBlockParam[];
  messages: MessageParam[];
  maxTokens?: number;
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
}

export interface CompleteResult {
  /** Concatenated text from all text blocks. */
  text: string;
  /** Any tool_use blocks Claude emitted (for the Researcher loop + checks). */
  toolUse: ToolUseBlock[];
  stopReason: string | null;
  rawUsage: RawUsage;
  usage: TurnUsage;
}

const DEFAULT_MAX_TOKENS = 16_000;

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function extractToolUse(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

/** Real backend backed by the official SDK. */
export function createAnthropicBackend(apiKey: string): LlmBackend {
  const client = new Anthropic({ apiKey });
  return {
    async create(body: CreateBody): Promise<LlmResponse> {
      // The SDK's typed params are a superset of CreateBody; cast at the boundary.
      const resp = await client.messages.create(
        body as unknown as Anthropic.MessageCreateParamsNonStreaming,
      );
      return resp as unknown as LlmResponse;
    },
  };
}

export class LlmClient {
  constructor(private readonly backend: LlmBackend) {}

  async complete(params: CompleteParams): Promise<CompleteResult> {
    const body: CreateBody = {
      model: params.model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: params.messages,
      ...(params.system !== undefined ? { system: params.system } : {}),
      ...(params.tools !== undefined ? { tools: params.tools } : {}),
      ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
    };
    const resp = await this.backend.create(body);
    const rawUsage = normalizeUsage(resp.usage);
    return {
      text: extractText(resp.content),
      toolUse: extractToolUse(resp.content),
      stopReason: resp.stop_reason,
      rawUsage,
      usage: toTurnUsage(params.model, rawUsage),
    };
  }
}
