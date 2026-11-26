import { ExtractionBusyError } from "./limits";

const MAX_WAITERS = 8;

// Separate download concurrency from parser concurrency. A slow storage read
// must not stop another already-downloaded tabular row from being parsed.
export type AdmissionOptions = { waitMs?: number; interactive?: boolean; signal?: AbortSignal };

export function admission(limit: number, maxWaiters = MAX_WAITERS) {
  const queue: Array<{ grant: () => void; interactive?: boolean }> = [];
  let active = 0;
  const run = async <T>(options: AdmissionOptions, work: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      if (options.waitMs === 0 || queue.length >= maxWaiters) throw new ExtractionBusyError();
      if (options.signal?.aborted) throw options.signal.reason;
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const grant = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", leave); resolve(); };
        const leave = () => { clearTimeout(timer); queue.splice(queue.indexOf(waiter), 1); reject(options.signal?.reason); };
        const waiter = { grant, interactive: options.interactive };
        options.signal?.addEventListener("abort", leave, { once: true });
        const background = options.interactive ? queue.findIndex((item) => !item.interactive) : -1;
        queue.splice(background < 0 ? queue.length : background, 0, waiter);
        if (options.waitMs !== undefined) timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", leave);
          queue.splice(queue.indexOf(waiter), 1);
          reject(new ExtractionBusyError());
        }, options.waitMs);
      });
    } else active++;
    try { return await work(); }
    finally {
      const next = queue.shift();
      if (next) next.grant();
      else active--;
    }
  };
  /** Slots nobody holds and nobody is waiting for. */
  return Object.assign(run, { free: () => (queue.length > 0 ? 0 : Math.max(0, limit - active)) });
}
