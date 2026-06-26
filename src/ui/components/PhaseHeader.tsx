import React from 'react';
import { Text } from 'ink';
import type { Phase } from '@/types';
import { theme } from '@/ui/theme';

const TITLES: Record<number, string> = {
  0: 'PHASE 0 — GROUNDING',
  1: 'PHASE 1 — OPENING ASSESSMENTS',
  2: 'PHASE 2 — ADVERSARIAL DEBATE',
  3: 'PHASE 3 — FEYNMAN AUDIT',
  4: 'PHASE 4 — VERDICT',
};

export function PhaseHeader({
  phase,
  round,
}: {
  phase: Phase;
  round: number | null;
}): React.ReactElement {
  const title = TITLES[phase] ?? `PHASE ${phase}`;
  const suffix = round !== null ? ` · ROUND ${round}` : '';
  return (
    <Text bold underline color={theme.orchestrator}>
      {title}
      {suffix}
    </Text>
  );
}
