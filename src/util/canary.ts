/**
 * Integrity canary — a long-output instruction-following probe.
 *
 * A persona is told to emit an exact marker phrase after every N words it
 * writes. If the model's instruction-following degrades as the output grows
 * (a well-known long-context failure mode), the markers thin out or stop. The
 * analyzer measures the cadence and reports whether the agent's discipline held.
 *
 * This is a diagnostic, off by default. Enable it via `AgentContext.canary` in
 * the runner, or drive it directly from `scripts/probe.ts`.
 */

export interface CanaryOptions {
  /** Emit the marker after roughly this many words. Must be > 0. */
  everyWords: number;
  /** The exact marker the model must reproduce (kept short + distinctive). */
  phrase: string;
}

export interface CanaryReport {
  totalWords: number;
  /** Markers we'd expect at this length and cadence. */
  expected: number;
  /** Markers actually found. */
  found: number;
  /** Largest run of words between two consecutive markers (or start/end). */
  maxGapWords: number;
  /** True when the cadence broke down — the signal that thinking/compliance decayed. */
  degraded: boolean;
  /** One-line human summary. */
  summary: string;
}

const DEFAULT_PHRASE = 'STILL-GROUNDED';

/** Build the instruction appended to a persona's task when the canary is on. */
export function buildCanaryDirective(opts: CanaryOptions): string {
  const phrase = opts.phrase || DEFAULT_PHRASE;
  return (
    `\n\n[INTEGRITY CANARY] Discipline check: after approximately every ${opts.everyWords} ` +
    `words you write, insert the exact marker «${phrase}» on its own, then continue. ` +
    `Reproduce it verbatim every time. This verifies your instruction-following holds ` +
    `across the whole response; do not let it lapse as the answer grows.`
  );
}

/** Count whitespace-delimited words, ignoring the marker tokens themselves. */
function countWords(text: string, phrase: string): number {
  const withoutMarkers = text.split(phrase).join(' ');
  const words = withoutMarkers.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Analyze a response for canary cadence. `degraded` is true when markers are
 * largely missing, or when any gap between markers runs well past the target
 * cadence (the agent stopped complying partway — the degradation signature).
 */
export function analyzeCanary(text: string, opts: CanaryOptions): CanaryReport {
  const phrase = opts.phrase || DEFAULT_PHRASE;
  const everyWords = Math.max(1, opts.everyWords);
  const totalWords = countWords(text, phrase);
  const expected = Math.floor(totalWords / everyWords);

  // Walk the text token by token, recording the word index at each marker.
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const markerWordIndices: number[] = [];
  let wordIndex = 0;
  for (const tok of tokens) {
    if (tok.includes(phrase)) {
      markerWordIndices.push(wordIndex);
    } else {
      wordIndex += 1;
    }
  }
  const found = markerWordIndices.length;

  // Gaps: start→first marker, between markers, last marker→end.
  let maxGapWords = 0;
  let prev = 0;
  for (const idx of markerWordIndices) {
    maxGapWords = Math.max(maxGapWords, idx - prev);
    prev = idx;
  }
  // Trailing remainder only counts as a gap if it exceeds the cadence — a short
  // tail after the last marker is expected and must not trip the detector.
  const tail = totalWords - prev;
  if (tail > everyWords) maxGapWords = Math.max(maxGapWords, tail);

  // Degraded if we found fewer than half the expected markers, or any gap ran
  // past ~1.5x the target cadence (allowing the model reasonable slack).
  const tooFew = expected >= 2 && found < expected / 2;
  const gapBlewOut = maxGapWords > everyWords * 1.5;
  // Below one full cadence of output there is nothing meaningful to measure.
  const measurable = totalWords >= everyWords;
  const degraded = measurable && (tooFew || gapBlewOut);

  const summary = !measurable
    ? `Too short to measure (${totalWords} words < ${everyWords} cadence).`
    : degraded
      ? `DEGRADED: ${found}/${expected} markers, largest silent gap ${maxGapWords} words (cadence ${everyWords}).`
      : `Held: ${found}/${expected} markers, largest gap ${maxGapWords} words (cadence ${everyWords}).`;

  return { totalWords, expected, found, maxGapWords, degraded, summary };
}
