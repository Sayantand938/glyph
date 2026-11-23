/** Conflict resolution: which of two copies of the same row survives a merge. */
import type { CardRow, Deck, Note } from "@/db/types"

/** Larger `updatedAt` wins; on a tie a tombstone wins, then local. */
export function pickDeck(local: Deck, incoming: Deck): Deck {
  if (incoming.updatedAt !== local.updatedAt) {
    return incoming.updatedAt > local.updatedAt ? incoming : local
  }
  return local.deletedAt === null && incoming.deletedAt !== null
    ? incoming
    : local
}

/**
 * Larger `contentUpdatedAt` wins. A tombstone beats a live row only if its
 * `deletedAt` is newer than the live row's `contentUpdatedAt`. Two tombstones:
 * newer content, then newer `deletedAt`. Ties keep local.
 */
export function pickNote(local: Note, incoming: Note): Note {
  const localDead = local.deletedAt !== null
  const incomingDead = incoming.deletedAt !== null

  if (localDead !== incomingDead) {
    const [dead, live] = localDead ? [local, incoming] : [incoming, local]
    return (dead.deletedAt as number) > live.contentUpdatedAt ? dead : live
  }
  if (incoming.contentUpdatedAt !== local.contentUpdatedAt) {
    return incoming.contentUpdatedAt > local.contentUpdatedAt ? incoming : local
  }
  if (
    localDead &&
    (incoming.deletedAt as number) > (local.deletedAt as number)
  ) {
    return incoming
  }
  return local
}

/** Larger `lastReview` wins; tie-break on `updatedAt`; ties keep local. */
export function pickCard(local: CardRow, incoming: CardRow): CardRow {
  if (incoming.lastReview !== local.lastReview) {
    return incoming.lastReview > local.lastReview ? incoming : local
  }
  return incoming.updatedAt > local.updatedAt ? incoming : local
}
