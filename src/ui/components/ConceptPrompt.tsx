import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '@/ui/theme';

/** Interactive concept entry when `council run` is invoked with no argument. */
export function ConceptPrompt({
  onSubmit,
}: {
  onSubmit: (concept: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Box flexDirection="column">
      <Text color={theme.orchestrator}>
        Describe the B2B / enterprise software concept to evaluate:
      </Text>
      <Box>
        <Text color={theme.muted}>{'> '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            if (v.trim()) onSubmit(v.trim());
          }}
        />
      </Box>
    </Box>
  );
}
