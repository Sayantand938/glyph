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
  OK_MESSAGE,
  Reassembler,
  failMessage,
  helloMessage,
  parseMessage,
  splitChunks,
  type PushResult,
  type SyncMessage,
} from "./protocol"
