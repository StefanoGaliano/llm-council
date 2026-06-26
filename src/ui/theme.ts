/**
 * Terminal theme (blueprint §7). Semantic colors as truecolor hex; Ink renders
 * them where the terminal supports it and degrades gracefully otherwise.
 */

export const theme = {
  orchestrator: '#A78BFA',
  flag: '#F87171',
  supported: '#34D399',
  contested: '#FBBF24',
  unsupported: '#F87171',
  muted: '#6B7280',
} as const;

export const decisionColor = {
  GO: theme.supported,
  CONDITIONAL_GO: theme.contested,
  NO_GO: theme.unsupported,
} as const;

export const tagColor = {
  SUPPORTED: theme.supported,
  CONTESTED: theme.contested,
  UNSUPPORTED: theme.unsupported,
} as const;
