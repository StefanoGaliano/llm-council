import React from 'react';
import { Box, Text } from 'ink';
import type { CostLedger } from '@/types';
import { theme } from '@/ui/theme';

/** Running token/USD meter pinned at the bottom. */
export function CostFooter({ cost }: { cost: CostLedger }): React.ReactElement {
  const tokens = cost.inputTokens + cost.outputTokens;
  return (
    <Box borderStyle="single" borderColor={theme.muted} paddingX={1}>
      <Text color={theme.muted}>
        {tokens.toLocaleString()} tokens ({cost.cachedTokens.toLocaleString()} cached) · $
        {cost.usd.toFixed(4)}
      </Text>
    </Box>
  );
}
