/**
 * Render the human-readable run artifacts: transcript.md (the full debate,
 * phase by phase, with flags inline) and verdict.md (the Decider's judgment +
 * score matrix). run.json is plain JSON (see run.ts).
 */

import type { Run, Verdict } from '@/types';
import { renderTurn } from '@/orchestrator/transcript';

const PHASE_TITLES: Record<number, string> = {
  1: 'Phase 1 — Opening Assessments',
  2: 'Phase 2 — Adversarial Debate',
  3: 'Phase 3 — Feynman Audit',
};

/** Render the full debate to transcript.md, grouped by phase. */
export function renderTranscriptMd(run: Run): string {
  const parts: string[] = [`# Transcript — ${run.concept}`, `> Run: ${run.id}`];
  let lastPhase = -1;
  for (const turn of run.transcript) {
    if (turn.phase !== lastPhase) {
      parts.push(`\n## ${PHASE_TITLES[turn.phase] ?? `Phase ${turn.phase}`}`);
      lastPhase = turn.phase;
    }
    parts.push(`\n${renderTurn(turn)}`);
  }
  if (run.conflictMap.length > 0) {
    parts.push('\n## Conflict Map');
    for (const c of run.conflictMap) {
      parts.push(`- ${c.description} (between ${c.betweenPersonas.join(', ') || 'unspecified'})`);
    }
  }
  if (run.objectionLedger.length > 0) {
    parts.push('\n## Objection Ledger (unresolved)');
    for (const o of run.objectionLedger) parts.push(`- ${o}`);
  }
  return parts.join('\n') + '\n';
}

function decisionLabel(d: Verdict['decision']): string {
  return d === 'NO_GO' ? 'NO-GO' : d === 'CONDITIONAL_GO' ? 'CONDITIONAL GO' : 'GO';
}

/** Render the Decider's verdict to verdict.md (returns a placeholder if absent). */
export function renderVerdictMd(run: Run): string {
  const v = run.verdict;
  if (!v) return `# Verdict — ${run.concept}\n\n_(no verdict — run did not reach Phase 4)_\n`;

  const parts: string[] = [`# Verdict — ${run.concept}`, `> Run: ${run.id}`];
  parts.push(`\n## Decision: **${decisionLabel(v.decision)}**`);
  parts.push(`\n${v.nextAction}`);

  parts.push('\n## Score Matrix');
  parts.push('| Dimension | Weight | Score | Cited Quotes |');
  parts.push('|---|---|---|---|');
  for (const d of v.scoreMatrix) {
    const quotes = d.citedQuotes.map((q) => `"${q}"`).join('; ');
    parts.push(`| ${d.dimension} | ${d.weight}% | ${d.score}/100 | ${quotes} |`);
  }

  parts.push('\n## Evidence Synthesis');
  for (const e of v.evidenceSynthesis) parts.push(`- [${e.tag}] ${e.claim}`);

  if (v.conflictResolutions.length > 0) {
    parts.push('\n## Conflict Resolutions');
    for (const c of v.conflictResolutions) {
      parts.push(`- ${c.conflict} → favored **${c.favoredPersona}**: ${c.rationale}`);
    }
  }

  if (v.decision === 'CONDITIONAL_GO' && v.conditions.length > 0) {
    parts.push('\n## Conditions');
    for (const c of v.conditions) parts.push(`- ${c}`);
  }
  if (v.decision === 'NO_GO' && v.killCondition) {
    parts.push(`\n## Kill Condition\n${v.killCondition}`);
  }
  if (v.unresolvedObjections.length > 0) {
    parts.push('\n## Unresolved Objections (automatic risk flags)');
    for (const o of v.unresolvedObjections) parts.push(`- ${o}`);
  }
  return parts.join('\n') + '\n';
}
