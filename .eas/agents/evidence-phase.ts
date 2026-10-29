export type EvidencePhase = { signal: AbortSignal; deadline: number };

export function evidencePhase(signal?: AbortSignal, timeoutMs = 300_000): EvidencePhase {
  return { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]), deadline: Date.now() + timeoutMs };
}

export function phaseBudget(phase: EvidencePhase, maximumMs: number) {
  phase.signal.throwIfAborted();
  const remaining = phase.deadline - Date.now();
  if (remaining <= 0) throw new Error('Evidence phase deadline exceeded.');
  return { signal: phase.signal, timeoutMs: Math.min(maximumMs, remaining) };
}
