import { describe, it, expect } from 'vitest';
import { analyzeCanary, buildCanaryDirective } from '@/util/canary';

const PHRASE = 'STILL-GROUNDED';

/** Build `words` words, inserting the marker every `every` words. */
function withMarkers(words: number, every: number, phrase = PHRASE): string {
  const out: string[] = [];
  for (let i = 1; i <= words; i++) {
    out.push(`w${i}`);
    if (i % every === 0) out.push(phrase);
  }
  return out.join(' ');
}

describe('buildCanaryDirective', () => {
  it('embeds the cadence and the exact phrase', () => {
    const d = buildCanaryDirective({ everyWords: 25, phrase: PHRASE });
    expect(d).toContain('25');
    expect(d).toContain(PHRASE);
    expect(d.toLowerCase()).toContain('canary');
  });
});

describe('analyzeCanary — healthy output', () => {
  it('reports held cadence when markers appear on schedule', () => {
    const text = withMarkers(100, 20); // marker every 20 words
    const r = analyzeCanary(text, { everyWords: 20, phrase: PHRASE });
    expect(r.totalWords).toBe(100);
    expect(r.found).toBe(5);
    expect(r.degraded).toBe(false);
    expect(r.maxGapWords).toBeLessThanOrEqual(20);
  });

  it('tolerates a short tail after the last marker', () => {
    const text = withMarkers(100, 20) + ' w101 w102 w103'; // 3-word tail < cadence
    const r = analyzeCanary(text, { everyWords: 20, phrase: PHRASE });
    expect(r.degraded).toBe(false);
  });
});

describe('analyzeCanary — degraded output (the signal we want)', () => {
  it('flags a gap blowout when the marker stops partway', () => {
    // Markers for the first 40 words, then 80 silent words — classic decay.
    const head = withMarkers(40, 20);
    const tail = Array.from({ length: 80 }, (_, i) => `t${i}`).join(' ');
    const r = analyzeCanary(`${head} ${tail}`, { everyWords: 20, phrase: PHRASE });
    expect(r.degraded).toBe(true);
    expect(r.maxGapWords).toBeGreaterThan(20 * 1.5);
    expect(r.summary).toMatch(/DEGRADED/);
  });

  it('flags too-few markers across a long output', () => {
    // 200 words, only one marker near the start.
    const text = `w1 w2 ${PHRASE} ` + Array.from({ length: 198 }, (_, i) => `x${i}`).join(' ');
    const r = analyzeCanary(text, { everyWords: 20, phrase: PHRASE });
    expect(r.expected).toBe(10);
    expect(r.found).toBe(1);
    expect(r.degraded).toBe(true);
  });
});

describe('analyzeCanary — guards', () => {
  it('does not measure outputs shorter than one cadence', () => {
    const r = analyzeCanary('only five short words here', { everyWords: 20, phrase: PHRASE });
    expect(r.degraded).toBe(false);
    expect(r.summary).toMatch(/Too short/);
  });

  it('does not count the marker tokens themselves as words', () => {
    const text = withMarkers(40, 20);
    const r = analyzeCanary(text, { everyWords: 20, phrase: PHRASE });
    expect(r.totalWords).toBe(40); // 2 markers excluded from the word count
  });
});
