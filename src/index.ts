#!/usr/bin/env node
/**
 * LLM Council CLI entry. Commander parses the surface (run / resume / config /
 * list) and mounts the Ink app. Protocol logic lives in the orchestrator — this
 * is a thin shell.
 */

import { Command } from 'commander';
import type { ModelTier } from '@/config/models';
import { EnvValidationError } from '@/config/env';

const TIERS: ModelTier[] = ['tiered', 'all-opus', 'all-sonnet'];

function parseTier(value: string): ModelTier {
  if ((TIERS as string[]).includes(value)) return value as ModelTier;
  throw new Error(`Invalid --model-tier "${value}". Use one of: ${TIERS.join(', ')}.`);
}

function fail(err: unknown): never {
  if (err instanceof EnvValidationError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exit(1);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('council')
    .description('Adversarial multi-agent evaluation of B2B/enterprise software concepts.')
    .version('0.1.0');

  program
    .command('run')
    .argument('[concept]', 'The concept to evaluate (omit for an interactive prompt)')
    .option('--model-tier <tier>', 'tiered | all-opus | all-sonnet', 'tiered')
    .description('Start a new evaluation')
    .action(async (concept: string | undefined, opts: { modelTier: string }) => {
      try {
        const { runRunCommand } = await import('@/commands/run');
        await runRunCommand(concept, { modelTier: parseTier(opts.modelTier) });
      } catch (err) {
        fail(err);
      }
    });

  program
    .command('resume')
    .argument('<run-id>', 'The id of the run to resume')
    .option('--pivot <change>', 'Pivot Protocol: re-ground with this change, then resume')
    .option('--model-tier <tier>', 'tiered | all-opus | all-sonnet', 'tiered')
    .description('Resume an interrupted run (optionally pivoting)')
    .action(async (runId: string, opts: { pivot?: string; modelTier: string }) => {
      try {
        const { runResumeCommand } = await import('@/commands/resume');
        await runResumeCommand(runId, {
          modelTier: parseTier(opts.modelTier),
          ...(opts.pivot ? { pivot: opts.pivot } : {}),
        });
      } catch (err) {
        fail(err);
      }
    });

  program
    .command('config')
    .description('Show which API credentials are set')
    .action(async () => {
      const { runConfigCommand } = await import('@/commands/config');
      process.stdout.write(`${runConfigCommand()}\n`);
    });

  program
    .command('list')
    .description('List past runs with verdict + cost')
    .action(async () => {
      const { runListCommand } = await import('@/commands/list');
      process.stdout.write(`${await runListCommand()}\n`);
    });

  return program;
}

// Only auto-run when invoked as the CLI (not when imported by tests).
// Matches both the compiled entry (`dist/index.js`) and the tsx dev entry
// (`src/index.ts`) so `pnpm dev run "<concept>"` works the same as the binary.
if (process.argv[1] && /index\.(js|ts)x?$/.test(process.argv[1])) {
  buildProgram().parseAsync(process.argv).catch(fail);
}
