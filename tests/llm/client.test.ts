import { describe, it, expect } from 'vitest';
import { LlmClient } from '@/llm/client';
import { MODEL_IDS } from '@/config/models';
import { MockBackend, textResponse, toolUseResponse } from '../helpers/mockAnthropic';

describe('LlmClient.complete', () => {
  it('extracts text + computes usage and forwards the request body', async () => {
    const backend = new MockBackend([
      textResponse('hello world', { input_tokens: 100, output_tokens: 10 }),
    ]);
    const client = new LlmClient(backend);

    const result = await client.complete({
      model: MODEL_IDS.sonnet,
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('hello world');
    expect(result.toolUse).toHaveLength(0);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.usd).toBeGreaterThan(0);
    // Default max_tokens applied; system + model forwarded.
    expect(backend.calls[0]).toMatchObject({
      model: MODEL_IDS.sonnet,
      system: 'be terse',
      max_tokens: 16_000,
    });
  });

  it('extracts tool_use blocks for structured tool calls', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', { flags: [] }, { id: 'toolu_1' }),
    ]);
    const client = new LlmClient(backend);

    const result = await client.complete({
      model: MODEL_IDS.opus,
      messages: [{ role: 'user', content: 'check' }],
      tools: [{ name: 'emit_flags', description: 'x', input_schema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'emit_flags' },
    });

    expect(result.toolUse).toHaveLength(1);
    expect(result.toolUse[0]).toMatchObject({ name: 'emit_flags', input: { flags: [] } });
    expect(backend.calls[0].tool_choice).toEqual({ type: 'tool', name: 'emit_flags' });
  });
});
