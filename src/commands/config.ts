/**
 * `council config` — report which API credentials are set. Read-only: it never
 * writes secrets, it shows status + where to set them (env / .env / ~/.councilrc).
 */

export interface ConfigKey {
  key: string;
  required: boolean;
  present: boolean;
}

const KEYS: { key: string; required: boolean }[] = [
  { key: 'ANTHROPIC_API_KEY', required: true },
  { key: 'TAVILY_API_KEY', required: true },
  { key: 'BRAVE_API_KEY', required: false },
  { key: 'GITHUB_TOKEN', required: false },
];

export function checkConfig(source: NodeJS.ProcessEnv = process.env): ConfigKey[] {
  return KEYS.map(({ key, required }) => ({
    key,
    required,
    present: typeof source[key] === 'string' && source[key]!.trim().length > 0,
  }));
}

export function formatConfigReport(keys: ConfigKey[]): string {
  const lines = keys.map((k) => {
    const mark = k.present ? '✓' : k.required ? '✗' : '·';
    const tag = k.required ? 'required' : 'optional';
    const status = k.present ? 'set' : 'missing';
    return `  ${mark} ${k.key.padEnd(18)} ${tag.padEnd(9)} ${status}`;
  });
  const missingRequired = keys.filter((k) => k.required && !k.present);
  const footer =
    missingRequired.length > 0
      ? `\nMissing required keys: ${missingRequired.map((k) => k.key).join(', ')}.\n` +
        `Set them in your shell, a .env file, or ~/.councilrc.`
      : '\nAll required keys are set.';
  return `Council configuration:\n${lines.join('\n')}\n${footer}`;
}

export function runConfigCommand(source?: NodeJS.ProcessEnv): string {
  return formatConfigReport(checkConfig(source));
}
