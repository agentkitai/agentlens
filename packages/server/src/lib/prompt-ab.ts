/**
 * Prompt A/B variant selection (#150) — pure + deterministic.
 *
 * Picks a weighted variant. With a `key` (e.g. a userId / sessionId) the choice
 * is sticky: the same key always resolves to the same variant, so a user sees a
 * consistent prompt while traffic splits by weight across the population.
 */
export interface AbVariant {
  versionId: string;
  label: string;
  weight: number;
}

// FNV-1a (32-bit) — stable across processes, unlike Math.random.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pick a variant by weight; deterministic when `key` is given, else random. */
export function pickVariant(variants: AbVariant[], key?: string): AbVariant | undefined {
  const active = variants.filter((v) => v.weight > 0);
  if (active.length === 0) return undefined;
  const total = active.reduce((s, v) => s + v.weight, 0);
  const r = key !== undefined ? fnv1a(key) % total : Math.floor(Math.random() * total);
  let acc = 0;
  for (const v of active) {
    acc += v.weight;
    if (r < acc) return v;
  }
  return active[active.length - 1];
}

/** Normalize/validate a variants array (positive integer weights, ≥1 active). */
export function normalizeVariants(input: unknown): AbVariant[] | null {
  if (!Array.isArray(input)) return null;
  const out: AbVariant[] = [];
  for (const v of input) {
    const versionId = (v as { versionId?: unknown })?.versionId;
    const weight = Number((v as { weight?: unknown })?.weight);
    if (typeof versionId !== 'string' || !versionId || !Number.isFinite(weight) || weight < 0) return null;
    out.push({ versionId, label: String((v as { label?: unknown }).label ?? versionId), weight: Math.floor(weight) });
  }
  if (out.length === 0 || out.reduce((s, v) => s + v.weight, 0) <= 0) return null;
  return out;
}
