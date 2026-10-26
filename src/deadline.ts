/**
 * What `run` resolves to, or a rejection when it fails, `timeoutMs` passes or `outer` aborts, even
 * if `run` ignores the signal it's given.
 */
export function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer: AbortSignal | undefined,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => run(signal))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
