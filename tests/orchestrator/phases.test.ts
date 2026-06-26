import { describe, it, expect } from 'vitest';
import {
  phase1Turns,
  phase2Turns,
  phase3Turns,
  PHASE2_ROUNDS,
  checkIntegrity,
} from '@/orchestrator/phases';
import { makeStateDocument } from '../helpers/fixtures';

describe('phase turn-order tables', () => {
  it('Phase 1 is the four opening assessments in order', () => {
    expect(phase1Turns().map((t) => t.personaId)).toEqual([
      'businessMan',
      'informatic',
      'financialMan',
      'ethicist',
    ]);
    expect(phase1Turns().every((t) => t.phase === 1 && t.round === null)).toBe(true);
  });

  it('Decider never speaks before Phase 4', () => {
    const all = [...phase1Turns(), ...[1, 2, 3].flatMap((r) => phase2Turns(r)), ...phase3Turns()];
    expect(all.some((t) => t.personaId === 'decider')).toBe(false);
  });

  it('Ethicist speaks only in Phase 2 Round 2 (and Phase 3)', () => {
    expect(phase2Turns(1).some((t) => t.personaId === 'ethicist')).toBe(false);
    expect(phase2Turns(2).some((t) => t.personaId === 'ethicist')).toBe(true);
    expect(phase2Turns(3).some((t) => t.personaId === 'ethicist')).toBe(false);
    expect(phase3Turns().some((t) => t.personaId === 'ethicist')).toBe(true);
  });

  it('runs three Phase 2 rounds carrying the round number', () => {
    expect(PHASE2_ROUNDS).toBe(3);
    expect(phase2Turns(2).every((t) => t.phase === 2 && t.round === 2)).toBe(true);
  });

  it('Phase 3 ends with the Client gap determination', () => {
    const order = phase3Turns().map((t) => t.personaId);
    expect(order[0]).toBe('informatic');
    expect(order[order.length - 1]).toBe('client');
  });
});

describe('checkIntegrity (Phase 0 gate)', () => {
  it('passes on a complete State Document', () => {
    expect(checkIntegrity(makeStateDocument())).toEqual({ ok: true, missing: [] });
  });

  it('flags an empty competitor matrix and blank market figures', () => {
    const doc = makeStateDocument({
      competitorMatrix: [],
      marketSizing: {
        tam: { figure: '', source: '', year: null },
        sam: { figure: '$2B', source: 's', year: 2025 },
        somYear1: { figure: '$5M', source: 's', year: 2026 },
      },
    });
    const res = checkIntegrity(doc);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('competitorMatrix');
    expect(res.missing).toContain('marketSizing.tam');
  });
});
