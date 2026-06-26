import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CostLedger, Phase, Run, Turn, Verdict } from '@/types';
import type { OrchestratorEvent } from '@/orchestrator/orchestrator';
import type { CouncilPersonaId } from '@/agents/registry';
import { emptyLedger } from '@/llm/cost';
import { PhaseHeader } from '@/ui/components/PhaseHeader';
import { AgentPane } from '@/ui/components/AgentPane';
import { ObjectionLedger } from '@/ui/components/ObjectionLedger';
import { ScoreMatrix } from '@/ui/components/ScoreMatrix';
import { CostFooter } from '@/ui/components/CostFooter';
import { theme } from '@/ui/theme';

export interface AppProps {
  /** Kicks off the run, forwarding orchestrator events to the UI. */
  start: (onEvent: (e: OrchestratorEvent) => void) => Promise<Run>;
  onDone?: (run: Run) => void;
}

/** Pure view: subscribes to orchestrator events and renders the live debate. */
export function App({ start, onDone }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>(0);
  const [round, setRound] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [active, setActive] = useState<CouncilPersonaId | null>(null);
  const [ledger, setLedger] = useState<string[]>([]);
  const [cost, setCost] = useState<CostLedger>(emptyLedger());
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const onEvent = (e: OrchestratorEvent): void => {
      if (cancelled) return;
      switch (e.type) {
        case 'phase:start':
          setPhase(e.phase);
          setRound(e.round);
          break;
        case 'turn:start':
          setActive(e.personaId);
          setPhase(e.phase);
          setRound(e.round);
          break;
        case 'turn:end':
          setTurns((t) => [...t, e.turn]);
          setActive(null);
          break;
        case 'ledger:update':
          setLedger(e.objectionLedger);
          break;
        case 'cost:update':
          setCost(e.cost);
          break;
        case 'verdict':
          setVerdict(e.verdict);
          break;
        default:
          break;
      }
    };

    start(onEvent)
      .then((run) => {
        if (cancelled) return;
        onDone?.(run);
        exit();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        exit(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column">
      <PhaseHeader phase={phase} round={round} />
      <Box flexDirection="column" marginY={1}>
        {turns.map((turn, i) => (
          <AgentPane key={i} personaId={turn.personaId as CouncilPersonaId} turn={turn} />
        ))}
        {active ? <AgentPane personaId={active} streaming /> : null}
      </Box>
      <ObjectionLedger items={ledger} />
      {verdict ? <ScoreMatrix verdict={verdict} /> : null}
      {error ? <Text color={theme.flag}>Error: {error}</Text> : null}
      <CostFooter cost={cost} />
    </Box>
  );
}
