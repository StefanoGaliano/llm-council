/**
 * Persona registry: maps each council PersonaId → its constitution + display
 * metadata + which model-routing role it uses. Phase/turn ordering lives in
 * src/orchestrator/phases.ts, not here.
 */

import type { PersonaId } from '@/types';
import type { CouncilRole } from '@/config/models';
import { decider } from '@/agents/constitutions/decider';
import { businessMan } from '@/agents/constitutions/businessMan';
import { marketingMan } from '@/agents/constitutions/marketingMan';
import { financialMan } from '@/agents/constitutions/financialMan';
import { informatic } from '@/agents/constitutions/informatic';
import { client } from '@/agents/constitutions/client';
import { ethicist } from '@/agents/constitutions/ethicist';

export interface PersonaSpec {
  id: PersonaId;
  displayName: string;
  glyph: string;
  /** Terminal accent (hex) for the TUI. */
  accent: string;
  constitution: string;
  /** Which model tier role this persona routes through. */
  modelRole: CouncilRole;
}

/** The 7 council personas (Researcher is handled separately in src/researcher). */
export const PERSONAS: Record<Exclude<PersonaId, 'researcher'>, PersonaSpec> = {
  decider: {
    id: 'decider',
    displayName: 'The Decider',
    glyph: '⚖️',
    accent: '#A78BFA',
    constitution: decider,
    modelRole: 'decider',
  },
  businessMan: {
    id: 'businessMan',
    displayName: 'The Business Man',
    glyph: '💼',
    accent: '#F87171',
    constitution: businessMan,
    modelRole: 'persona',
  },
  marketingMan: {
    id: 'marketingMan',
    displayName: 'The Marketing Man',
    glyph: '📣',
    accent: '#22D3EE',
    constitution: marketingMan,
    modelRole: 'persona',
  },
  financialMan: {
    id: 'financialMan',
    displayName: 'The Financial Man',
    glyph: '📊',
    accent: '#34D399',
    constitution: financialMan,
    modelRole: 'persona',
  },
  informatic: {
    id: 'informatic',
    displayName: 'The Informatic',
    glyph: '💻',
    accent: '#60A5FA',
    constitution: informatic,
    modelRole: 'persona',
  },
  client: {
    id: 'client',
    displayName: 'The Client',
    glyph: '👑',
    accent: '#FBBF24',
    constitution: client,
    modelRole: 'persona',
  },
  ethicist: {
    id: 'ethicist',
    displayName: 'The Ethicist',
    glyph: '🧭',
    accent: '#E879F9',
    constitution: ethicist,
    modelRole: 'persona',
  },
};

export type CouncilPersonaId = keyof typeof PERSONAS;

export function getPersona(id: CouncilPersonaId): PersonaSpec {
  return PERSONAS[id];
}
