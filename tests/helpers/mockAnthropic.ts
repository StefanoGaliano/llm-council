/**
 * Deterministic LLM stub for tests. No network. Scripts a queue of responses
 * (or a single responder fn) and records every request body it received.
 */

import type { CreateBody, LlmBackend, LlmResponse, ContentBlock } from '@/llm/client';

export interface MockUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Build a text-only response. */
export function textResponse(text: string, usage: MockUsage = {}): LlmResponse {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage,
  };
}

/** Build a tool-use response (e.g. an orchestrator check or researcher tool call). */
export function toolUseResponse(
  name: string,
  input: unknown,
  opts: { id?: string; text?: string; usage?: MockUsage; stopReason?: string } = {},
): LlmResponse {
  const content: ContentBlock[] = [];
  if (opts.text) content.push({ type: 'text', text: opts.text });
  content.push({ type: 'tool_use', id: opts.id ?? 'toolu_test', name, input });
  return {
    content,
    stop_reason: opts.stopReason ?? 'tool_use',
    usage: opts.usage ?? {},
  };
}

export type Responder = (body: CreateBody, callIndex: number) => LlmResponse;

export class MockBackend implements LlmBackend {
  readonly calls: CreateBody[] = [];
  private queue: LlmResponse[] = [];
  private responder: Responder | undefined;

  constructor(scripted?: LlmResponse[] | Responder) {
    if (typeof scripted === 'function') this.responder = scripted;
    else if (Array.isArray(scripted)) this.queue = [...scripted];
  }

  /** Append more scripted responses to the queue. */
  enqueue(...responses: LlmResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  create(body: CreateBody): Promise<LlmResponse> {
    const index = this.calls.length;
    // Deep-clone: callers mutate the live `messages` array across loop iterations,
    // so store a snapshot to make per-call assertions meaningful.
    this.calls.push(structuredClone(body));
    if (this.responder) return Promise.resolve(this.responder(body, index));
    const next = this.queue.shift();
    if (!next) {
      return Promise.reject(new Error(`MockBackend: no scripted response for call #${index}`));
    }
    return Promise.resolve(next);
  }
}
