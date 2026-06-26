/**
 * `council list` — list past runs with verdict + cost.
 */

import { listRuns, type RunSummary } from '@/persistence/run';

const DECISION_LABEL: Record<string, string> = {
  GO: 'GO',
  CONDITIONAL_GO: 'COND. GO',
  NO_GO: 'NO-GO',
};

export function formatRunList(summaries: RunSummary[]): string {
  if (summaries.length === 0) return 'No runs yet. Start one with `council run "<concept>"`.';
  const rows = summaries.map((s) => {
    const verdict = s.decision ? (DECISION_LABEL[s.decision] ?? s.decision) : `phase ${s.phase}`;
    const concept = s.concept.length > 40 ? `${s.concept.slice(0, 37)}…` : s.concept;
    return `  ${s.createdAt}  ${verdict.padEnd(9)} $${s.usd.toFixed(4).padStart(8)}  ${concept}`;
  });
  return `Past runs (newest first):\n${rows.join('\n')}`;
}

export async function runListCommand(root?: string): Promise<string> {
  return formatRunList(await listRuns(root));
}
