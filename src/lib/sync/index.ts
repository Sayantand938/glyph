/**
 * Device-to-device sync: the pure parts (pairing codes, wire protocol). The
 * WebRTC connection is `rtc.ts` and the merge is `importBackup()` in src/db/repo.
 */
export {
  decodePairing,
  encodePairing,
  type DecodedPairing,
  type PairingKind,
} from "./pairing"
export {
  CHUNK_BYTES,
  Reassembler,
  SYNC_VERSION,
  endMessage,
  failMessage,
  hiMessage,
  okMessage,
  parseMessage,
  partMessage,
  planMessage,
  splitChunks,
  type PushResult,
  type SyncMessage,
  type SyncMode,
} from "./protocol"
export {
  PART_ROWS,
  SYNC_OVERLAP_MS,
  countsEqual,
  deltaSince,
  pagesOf,
  parseCounts,
  parseMarks,
  withMark,
  type RowCounts,
  type SyncMarks,
} from "./delta"
export {
  SyncSession,
  type SyncDeps,
  type SyncEvents,
  type SyncIO,
  type SyncProgress,
} from "./session"
