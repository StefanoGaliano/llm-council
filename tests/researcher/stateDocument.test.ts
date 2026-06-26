import { describe, it, expect } from 'vitest';
import {
  renderStateDocument,
  renderStateDocumentCompact,
  chooseStateMarkdown,
  computeOverwrites,
} from '@/researcher/stateDocument';
import { makeStateDocument } from '../helpers/fixtures';

describe('renderStateDocument', () => {
  it('renders the header, timestamp, and all §2 sections', () => {
    const md = renderStateDocument(makeStateDocument());
    expect(md).toContain('# State Document');
    expect(md).toContain('2026-06-25T12:00:00.000Z');
    expect(md).toContain('## Competitor Matrix');
    expect(md).toContain('Vanta');
    expect(md).toContain('## Market Sizing');
    expect(md).toContain('## Regulatory Landscape');
  });

  it('renders nulls as em dashes', () => {
    const md = renderStateDocument(makeStateDocument());
    // Vanta has null githubStars/lastCommit → should appear as —
    expect(md).toContain('| Vanta |');
    expect(md).toMatch(/Vanta.*—/);
  });

  it('omits the overwrite-log section when empty, includes it when present', () => {
    expect(renderStateDocument(makeStateDocument())).not.toContain('Memory Overwrite Log');
    const withLog = makeStateDocument({
      overwriteLog: [
        { field: 'conceptSummary', reason: 'pivot', oldValue: 'a', newValue: 'b', timestamp: 't' },
      ],
    });
    expect(renderStateDocument(withLog)).toContain('Memory Overwrite Log');
  });
});

describe('computeOverwrites', () => {
  it('logs one entry per changed field with old/new values', () => {
    const oldDoc = makeStateDocument();
    const newDoc = makeStateDocument({ conceptSummary: 'A pivoted concept.' });
    const entries = computeOverwrites(oldDoc, newDoc, 'user pivot', 'ts-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      field: 'conceptSummary',
      reason: 'user pivot',
      timestamp: 'ts-1',
    });
    expect(entries[0]?.oldValue).toContain('SOC2');
    expect(entries[0]?.newValue).toContain('pivoted');
  });

  it('returns no entries when documents are identical', () => {
    const doc = makeStateDocument();
    expect(computeOverwrites(doc, makeStateDocument(), 'noop', 'ts')).toHaveLength(0);
  });

  it('detects array (competitorMatrix) changes', () => {
    const oldDoc = makeStateDocument();
    const newDoc = makeStateDocument({ competitorMatrix: [] });
    const entries = computeOverwrites(oldDoc, newDoc, 're-ground', 'ts');
    expect(entries.map((e) => e.field)).toContain('competitorMatrix');
  });
});

describe('Token Context Rule — compact render', () => {
  it('preserves all quantitative data while shrinking the document', () => {
    const doc = makeStateDocument();
    const full = renderStateDocument(doc);
    const compact = renderStateDocumentCompact(doc);

    expect(compact.length).toBeLessThan(full.length);
    // Quantitative grounding preserved: funding, stars, market figures, risk.
    expect(compact).toContain('200000000'); // Vanta funding
    expect(compact).toContain('$10B'); // TAM
    expect(compact).toContain('2/5'); // displacement risk
    expect(compact).toContain('Vanta');
  });

  it('chooseStateMarkdown switches to compact past the threshold', () => {
    const doc = makeStateDocument();
    expect(chooseStateMarkdown(doc, 100)).toContain('# State Document\n');
    expect(chooseStateMarkdown(doc, 100_000)).toContain('# State Document (compact)');
  });
});
