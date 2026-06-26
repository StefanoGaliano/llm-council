/**
 * Render a validated Researcher payload → human-readable `state.md` (System
 * Prompt §2 layout), and compute [MEMORY_OVERWRITE] diffs for the Pivot Protocol.
 */

import type {
  StateDocument,
  Competitor,
  OssAlt,
  Benchmark,
  RegItem,
  TalentItem,
  OverwriteEntry,
} from '@/types';

function n(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

function competitorRow(c: Competitor): string {
  return (
    `| ${c.name} | ${c.stage} | ${n(c.totalFundingUsd)} | ${c.coreDifferentiator} | ` +
    `${n(c.githubStars)} | ${n(c.lastCommitDaysAgo, 'd')} | ${c.recentSignal} | ${c.confidence} |`
  );
}

function ossRow(o: OssAlt): string {
  return `| ${o.project} | ${n(o.stars)} | ${n(o.lastCommitDaysAgo, 'd')} | ${o.maturityLevel} | ${o.displacementRiskScore}/5 |`;
}

function benchmarkRow(b: Benchmark): string {
  return `| ${b.metric} | ${b.latency ?? '—'} | ${b.computeCostPerUnit ?? '—'} | ${b.uptimeSla ?? '—'} |`;
}

function regRow(r: RegItem): string {
  return `| ${r.framework} | ${r.enforcementPrecedent} |`;
}

function talentRow(t: TalentItem): string {
  return `| ${t.role} | ${t.supplyDemand} | ${t.notableMovement} |`;
}

function section(title: string, header: string, rows: string[]): string {
  const body = rows.length > 0 ? rows.join('\n') : '| _(none found)_ |';
  return `## ${title}\n\n${header}\n${body}\n`;
}

/** Render the State Document to a markdown string for `state.md`. */
export function renderStateDocument(doc: StateDocument): string {
  const parts: string[] = [];
  parts.push(`# State Document\n`);
  parts.push(`> Grounding timestamp: ${doc.timestamp}\n`);
  parts.push(`## Concept Summary\n\n${doc.conceptSummary}\n`);

  parts.push(
    section(
      'Competitor Matrix',
      '| Name | Stage | Funding (USD) | Differentiator | Stars | Last Commit | Recent Signal | Confidence |\n|---|---|---|---|---|---|---|---|',
      doc.competitorMatrix.map(competitorRow),
    ),
  );

  parts.push(
    section(
      'Open-Source Alternatives',
      '| Project | Stars | Last Commit | Maturity | Displacement Risk |\n|---|---|---|---|---|',
      doc.openSourceAlternatives.map(ossRow),
    ),
  );

  const m = doc.marketSizing;
  parts.push(
    `## Market Sizing\n\n` +
      `| Tier | Figure | Source | Year |\n|---|---|---|---|\n` +
      `| TAM | ${m.tam.figure} | ${m.tam.source} | ${n(m.tam.year)} |\n` +
      `| SAM | ${m.sam.figure} | ${m.sam.source} | ${n(m.sam.year)} |\n` +
      `| SOM (Y1) | ${m.somYear1.figure} | ${m.somYear1.source} | ${n(m.somYear1.year)} |\n`,
  );

  parts.push(
    section(
      'Technical Infrastructure Benchmarks',
      '| Metric | Latency | Compute Cost/Unit | Uptime SLA |\n|---|---|---|---|',
      doc.technicalInfraBenchmarks.map(benchmarkRow),
    ),
  );

  parts.push(
    section(
      'Regulatory Landscape',
      '| Framework | Enforcement Precedent |\n|---|---|',
      doc.regulatoryLandscape.map(regRow),
    ),
  );

  parts.push(
    section(
      'Talent Signal',
      '| Role | Supply/Demand | Notable Movement |\n|---|---|---|',
      doc.talentSignal.map(talentRow),
    ),
  );

  if (doc.overwriteLog.length > 0) {
    const rows = doc.overwriteLog.map(
      (o) => `| ${o.timestamp} | ${o.field} | ${o.oldValue} | ${o.newValue} | ${o.reason} |`,
    );
    parts.push(
      section(
        'Memory Overwrite Log',
        '| Timestamp | Field | Old | New | Reason |\n|---|---|---|---|---|',
        rows,
      ),
    );
  }

  return parts.join('\n');
}

/**
 * Compact State Document render for the Token Context Rule (non-negotiable #8):
 * when the proceedings grow large, the State Document stays at the top of every
 * phase's context but is compressed — ALL quantitative data is preserved
 * (funding, stars, last-commit, displacement risk, market figures/years,
 * benchmarks), while long free-text fields are truncated.
 */
function clip(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function renderStateDocumentCompact(doc: StateDocument): string {
  const parts: string[] = [];
  parts.push(`# State Document (compact)\n`);
  parts.push(`> Grounding timestamp: ${doc.timestamp}\n`);
  parts.push(`## Concept\n${clip(doc.conceptSummary, 160)}\n`);

  parts.push(
    section(
      'Competitors',
      '| Name | Stage | Funding | Stars | LastCommit | Conf |\n|---|---|---|---|---|---|',
      doc.competitorMatrix.map(
        (c) =>
          `| ${clip(c.name, 24)} | ${clip(c.stage, 16)} | ${n(c.totalFundingUsd)} | ${n(c.githubStars)} | ${n(c.lastCommitDaysAgo, 'd')} | ${c.confidence} |`,
      ),
    ),
  );

  parts.push(
    section(
      'OSS Alternatives',
      '| Project | Stars | LastCommit | Risk |\n|---|---|---|---|',
      doc.openSourceAlternatives.map(
        (o) =>
          `| ${clip(o.project, 24)} | ${n(o.stars)} | ${n(o.lastCommitDaysAgo, 'd')} | ${o.displacementRiskScore}/5 |`,
      ),
    ),
  );

  const m = doc.marketSizing;
  parts.push(
    `## Market Sizing\n` +
      `TAM ${m.tam.figure} (${n(m.tam.year)}) · SAM ${m.sam.figure} (${n(m.sam.year)}) · SOM ${m.somYear1.figure} (${n(m.somYear1.year)})\n`,
  );

  if (doc.technicalInfraBenchmarks.length > 0) {
    parts.push(
      section(
        'Benchmarks',
        '| Metric | Latency | Cost/Unit | SLA |\n|---|---|---|---|',
        doc.technicalInfraBenchmarks.map(benchmarkRow),
      ),
    );
  }

  return parts.join('\n');
}

/**
 * Pick the full or compact State Document render based on how large the rest of
 * the phase context (the transcript slice) already is. Keeps the quantitative
 * grounding present without blowing the context budget.
 */
export function chooseStateMarkdown(
  doc: StateDocument,
  transcriptChars: number,
  threshold = 24_000,
): string {
  return transcriptChars > threshold ? renderStateDocumentCompact(doc) : renderStateDocument(doc);
}

/**
 * Compute [MEMORY_OVERWRITE] entries by diffing the top-level scalar/summary
 * fields of an old vs new State Document (used during re-grounding / pivots).
 * Returns one entry per changed field; arrays are compared by JSON length+content.
 */
export function computeOverwrites(
  oldDoc: StateDocument,
  newDoc: StateDocument,
  reason: string,
  timestamp: string,
): OverwriteEntry[] {
  const entries: OverwriteEntry[] = [];
  const fields: Array<keyof StateDocument> = [
    'conceptSummary',
    'competitorMatrix',
    'openSourceAlternatives',
    'marketSizing',
    'technicalInfraBenchmarks',
    'regulatoryLandscape',
    'talentSignal',
  ];
  for (const field of fields) {
    const oldVal = JSON.stringify(oldDoc[field]);
    const newVal = JSON.stringify(newDoc[field]);
    if (oldVal !== newVal) {
      entries.push({
        field,
        reason,
        oldValue: oldVal,
        newValue: newVal,
        timestamp,
      });
    }
  }
  return entries;
}
