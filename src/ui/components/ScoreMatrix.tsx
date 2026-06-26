import React from 'react';
import { Box, Text } from 'ink';
import type { Verdict } from '@/types';
import { decisionColor, tagColor, theme } from '@/ui/theme';

const DECISION_LABEL: Record<Verdict['decision'], string> = {
  GO: 'GO',
  CONDITIONAL_GO: 'CONDITIONAL GO',
  NO_GO: 'NO-GO',
};

/** Decider's weighted matrix + verdict block (Phase 4). */
export function ScoreMatrix({ verdict }: { verdict: Verdict }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={decisionColor[verdict.decision]}>
        VERDICT: {DECISION_LABEL[verdict.decision]}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {verdict.scoreMatrix.map((d, i) => (
          <Text key={i}>
            <Text color={theme.muted}>{d.dimension.padEnd(28)}</Text> {d.weight}% · {d.score}/100
          </Text>
        ))}
      </Box>
      {verdict.evidenceSynthesis.length > 0 ? (
        <Box flexDirection="column">
          {verdict.evidenceSynthesis.map((e, i) => (
            <Text key={i} color={tagColor[e.tag]}>
              [{e.tag}] {e.claim}
            </Text>
          ))}
        </Box>
      ) : null}
      {verdict.decision === 'NO_GO' && verdict.killCondition ? (
        <Text color={theme.unsupported}>Kill: {verdict.killCondition}</Text>
      ) : null}
      <Text>→ {verdict.nextAction}</Text>
    </Box>
  );
}
