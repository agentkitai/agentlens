import { monotonicFactory } from 'ulid';

/**
 * Monotonic ULID generator for audit-chain event ids.
 *
 * Plain ulid() is only time-ordered to the millisecond — two ids minted in the
 * same millisecond sort in random order. The audit hash chain is built in
 * insertion order but verification reads events ordered by (timestamp, id), so
 * a non-monotonic tiebreaker makes a same-millisecond batch verify as "broken".
 *
 * A single shared monotonic factory guarantees ids strictly increase in mint
 * order across every ingest path in this process, so `id ASC` reliably reflects
 * chain order even within a millisecond.
 */
export const nextEventId = monotonicFactory();
