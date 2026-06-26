import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '@/ui/theme';

/** The Client's running unresolved concerns (Phase 2+). */
export function ObjectionLedger({ items }: { items: string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.contested}>
        👑 Objection Ledger
      </Text>
      {items.map((o, i) => (
        <Text key={i} color={theme.muted}>
          • {o}
        </Text>
      ))}
    </Box>
  );
}
