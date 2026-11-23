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
  pingMessage,
  planMessage,
  splitChunks,
  type PushResult,
  type SyncMessage,
  type SyncMode,
} from "./protocol"
export {
  DIGEST_LABELS,
  DIGEST_TABLES,
  DigestBuilder,
  PART_ROWS,
  SYNC_OVERLAP_MS,
  cardStamp,
  deckStamp,
  deltaSince,
  differingTables,
  digestOf,
  digestsEqual,
  idStamp,
  noteStamp,
  pagesOf,
  parseDigests,
  parseMarks,
  settingStamp,
  withMark,
  type DigestTable,
  type RowDigest,
  type SyncDigests,
  type SyncMarks,
} from "./delta"
export {
  STALL_MS,
  SyncSession,
  type SyncDeps,
  type SyncEvents,
  type SyncIO,
  type SyncProgress,
} from "./session"
export {
  analyzeSdp,
  classifyAddress,
  codeWarning,
  comparePeers,
  connectFailureMessage,
  describeAnalysis,
  parseCandidates,
  type Analysis,
  type Candidate,
  type Comparison,
} from "./diagnose"
