/**
 * Render a list of Turns to the markdown proceedings slice injected into later
 * persona prompts and the orchestrator's synthesis calls. Inline flags make
 * breaches visible to downstream personas (and to transcript.md in Step 11).
 */

import type { Turn } from '@/types';
import { PERSONAS, type CouncilPersonaId } from '@/agents/registry';

function displayName(personaId: Turn['personaId']): string {
  if (personaId === 'researcher') return 'Researcher';
  return PERSONAS[personaId as CouncilPersonaId]?.displayName ?? personaId;
}

function header(turn: Turn): string {
  const round = turn.round !== null ? `, Round ${turn.round}` : '';
  const resub = turn.resubmission ? ' (re-submission)' : '';
  return `### ${displayName(turn.personaId)} — Phase ${turn.phase}${round}${resub}`;
}

function flagLines(turn: Turn): string {
  if (turn.flags.length === 0) return '';
  const lines = turn.flags.map(
    (f) => `> [ORCHESTRATOR FLAG: ${f.type}${f.resolved ? ' — resolved' : ''}] ${f.detail}`,
  );
  return `\n\n${lines.join('\n')}`;
}

/** Render one turn to markdown. */
export function renderTurn(turn: Turn): string {
  return `${header(turn)}\n\n${turn.content}${flagLines(turn)}`;
}

/** Render a sequence of turns to a markdown transcript. */
export function renderTranscript(turns: Turn[]): string {
  return turns.map(renderTurn).join('\n\n');
}
