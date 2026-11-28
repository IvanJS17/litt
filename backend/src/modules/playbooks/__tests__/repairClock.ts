import { vi } from "vitest";
import { setRepairObserverForTests } from "../../../lib/boundedJsonRepair";

/**
 * Runs `work` on an injected clock (every reading of it moves 600 ms on) and
 * returns the time each repair of a model's reply was allowed, in order.
 */
export async function repairTimesAllowed(work: () => Promise<unknown>): Promise<number[]> {
  const allowed: number[] = [];
  let clock = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => (clock += 600));
  setRepairObserverForTests((_chars, allowedMs) => allowed.push(allowedMs));
  try {
    await work();
  } finally {
    setRepairObserverForTests(null);
    now.mockRestore();
  }
  return allowed;
}

/** One operation shares one budget: only its first repair gets the whole second. */
export const sharesOneBudget = (allowed: number[]): boolean =>
  allowed[0] === 1_000 && allowed.slice(1).every((ms) => ms < 1_000);
