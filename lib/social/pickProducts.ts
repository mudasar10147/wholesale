/** Fisher–Yates. Returns a new array; the input is not mutated. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A fresh random selection on every call — this is what the "reload" button uses. */
export function pickRandom<T>(all: readonly T[], count: number): T[] {
  return shuffle(all).slice(0, Math.max(0, Math.min(count, all.length)));
}
