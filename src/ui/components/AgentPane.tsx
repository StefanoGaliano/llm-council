import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Turn } from '@/types';
import { PERSONAS, type CouncilPersonaId } from '@/agents/registry';
import { FlagBanner } from '@/ui/components/FlagBanner';

export interface AgentPaneProps {
  personaId: CouncilPersonaId;
  /** The finalized turn, or undefined while the agent is still streaming. */
  turn?: Turn;
  streaming?: boolean;
}

/** One agent's output pane: name + accent border, body, inline flags. */
export function AgentPane({ personaId, turn, streaming }: AgentPaneProps): React.ReactElement {
  const persona = PERSONAS[personaId];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={persona.accent} paddingX={1}>
      <Text bold color={persona.accent}>
        {persona.glyph} {persona.displayName}
        {turn?.resubmission ? ' (re-submission)' : ''}
      </Text>
      {turn ? <Text>{turn.content}</Text> : null}
      {streaming && !turn ? (
        <Text color={persona.accent}>
          <Spinner type="dots" /> thinking…
        </Text>
      ) : null}
      {turn && turn.flags.length > 0 ? <FlagBanner flags={turn.flags} /> : null}
    </Box>
  );
}
