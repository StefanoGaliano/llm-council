import React from 'react';
import { Box, Text } from 'ink';
import type { Flag } from '@/types';
import { theme } from '@/ui/theme';

/** Impossible-to-miss red box for orchestrator flags (blueprint §7). */
export function FlagBanner({ flags }: { flags: Flag[] }): React.ReactElement | null {
  if (flags.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.flag} paddingX={1}>
      {flags.map((f, i) => (
        <Text key={i} bold color={theme.flag}>
          [ORCHESTRATOR FLAG: {f.type}
          {f.resolved ? ' — resolved' : ''}] {f.detail}
        </Text>
      ))}
    </Box>
  );
}
