/**
 * Row validators for backup parsing. Each builds a clean copy, so unknown
 * fields never reach the database.
 */
import type { BackupImage, CardRow, Deck, Note, RevlogRow } from "@/db/types"
import { isFlag } from "@/lib/card-marks"
import { IMAGE_ID_RE, isImageMime, looksLikeBase64 } from "@/lib/image"
import { parseTags } from "@/lib/tags"

export type Rec = Record<string, unknown>

export function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function isStr(value: unknown): value is string {
  return typeof value === "string"
}

function isNullableTime(value: unknown): value is number | null {
  return value === null || isNum(value)
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return isNum(value) && Number.isInteger(value) && value >= min && value <= max
}

export function readDeck(v: unknown): Deck | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "") return null
  if (!(v.parentId === null || isStr(v.parentId))) return null
  if (!isStr(v.name) || !isNum(v.updatedAt) || !isNullableTime(v.deletedAt)) {
    return null
  }
  return {
    id: v.id,
    parentId: v.parentId,
    name: v.name,
    updatedAt: v.updatedAt,
    deletedAt: v.deletedAt,
  }
}

export function readNote(v: unknown): Note | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "" || !isStr(v.topicId)) return null
  if (!(isNum(v.sl) || isStr(v.sl))) return null
  if (!isStr(v.question) || !isStr(v.extra)) return null
  const o = v.options
  if (!Array.isArray(o) || o.length !== 4 || !o.every(isStr)) return null
  if (!isIntIn(v.correctIndex, 0, 3)) return null
  if (!isNum(v.contentUpdatedAt) || !isNullableTime(v.deletedAt)) return null
  // Absent in schema version 1 and 2 files; when present it must be a list of text.
  if (v.tags !== undefined && !(Array.isArray(v.tags) && v.tags.every(isStr))) {
    return null
  }
  return {
    id: v.id,
    topicId: v.topicId,
    sl: v.sl,
    question: v.question,
    options: [o[0], o[1], o[2], o[3]],
    correctIndex: v.correctIndex as Note["correctIndex"],
    extra: v.extra,
    tags: v.tags === undefined ? [] : parseTags(v.tags),
    contentUpdatedAt: v.contentUpdatedAt,
    deletedAt: v.deletedAt,
  }
}

export function readCard(v: unknown): CardRow | null {
  if (!isRec(v)) return null
  if (!isStr(v.cardId) || v.cardId === "") return null
  if (!isStr(v.noteId) || !isStr(v.topicId)) return null
  if (!isIntIn(v.state, 0, 3)) return null
  const nums = [
    v.due,
    v.stability,
    v.difficulty,
    v.elapsedDays,
    v.scheduledDays,
    v.learningSteps,
    v.reps,
    v.lapses,
    v.lastReview,
    v.updatedAt,
  ]
  if (!nums.every(isNum)) return null
  // The card marks are absent in schema version 1-3 files (an unmarked card);
  // when present they must be well formed.
  if (v.flag !== undefined && !isFlag(v.flag)) return null
  if (v.suspended !== undefined && typeof v.suspended !== "boolean") return null
  if (v.buriedUntil !== undefined && !isNum(v.buriedUntil)) return null
  if (v.markedAt !== undefined && !isNum(v.markedAt)) return null
  return {
    cardId: v.cardId,
    noteId: v.noteId,
    topicId: v.topicId,
    due: v.due as number,
    stability: v.stability as number,
    difficulty: v.difficulty as number,
    elapsedDays: v.elapsedDays as number,
    scheduledDays: v.scheduledDays as number,
    learningSteps: v.learningSteps as number,
    reps: v.reps as number,
    lapses: v.lapses as number,
    state: v.state,
    lastReview: v.lastReview as number,
    updatedAt: v.updatedAt as number,
    flag: v.flag === undefined ? 0 : (v.flag as number),
    suspended: v.suspended === true,
    buriedUntil: v.buriedUntil === undefined ? 0 : (v.buriedUntil as number),
    markedAt: v.markedAt === undefined ? 0 : (v.markedAt as number),
  }
}

export function readImage(v: unknown): BackupImage | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || !IMAGE_ID_RE.test(v.id)) return null
  if (!isImageMime(v.mime)) return null
  if (!isIntIn(v.width, 1, 100_000) || !isIntIn(v.height, 1, 100_000)) {
    return null
  }
  if (!isStr(v.data) || !looksLikeBase64(v.data)) return null
  return {
    id: v.id,
    mime: v.mime,
    width: v.width,
    height: v.height,
    data: v.data,
  }
}

export function readLog(v: unknown): RevlogRow | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "" || !isStr(v.cardId)) return null
  if (!isNum(v.reviewedAt) || !isNum(v.durationMs)) return null
  if (!isIntIn(v.rating, 1, 4) || !isIntIn(v.state, 0, 3)) return null
  return {
    id: v.id,
    cardId: v.cardId,
    reviewedAt: v.reviewedAt,
    rating: v.rating,
    state: v.state,
    durationMs: v.durationMs,
  }
}
