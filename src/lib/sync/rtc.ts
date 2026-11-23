import { decodePairing, encodePairing } from "./pairing"

/**
 * The WebRTC side of sync (browser only, so not unit-tested, like
 * `lib/image/encode.ts`). Two devices on one network connect directly through a
 * data channel. There is no signalling server: the session descriptions travel
 * as pairing codes the user moves by hand (copy and paste). No ICE servers
 * are configured, so nothing leaves the local network and the app makes no
 * outside calls; the cost is that it only works when the devices can reach each
 * other (not on a guest network that isolates clients). A person can turn on a
 * public STUN server (`stun: true`, off by default and per device): that asks
 * the server for this device's public address, which breaks the no-outside-calls
 * rule, and helps when the devices are on different networks.
 */

/** The STUN server used when the person turns it on. */
export const PUBLIC_STUN_URL = "stun:stun.cloudflare.com:3478"

export interface RtcOptions {
  stun?: boolean
}

function configFor(options: RtcOptions): RTCConfiguration {
  return {
    iceServers: options.stun ? [{ urls: PUBLIC_STUN_URL }] : [],
  }
}

export interface Link {
  send(text: string): void
  /** Sends chunks in order, waiting whenever the channel's buffer is full. */
  sendChunks(chunks: Uint8Array[]): Promise<void>
  close(): void
}

export interface LinkHandlers {
  onOpen(link: Link): void
  onText(text: string): void
  onBinary(data: Uint8Array): void
  /** The connection ended or could not be made (also fires after `close()`). */
  onClose(reason: "closed" | "failed"): void
}

const GATHER_TIMEOUT_MS = 4000
const BUFFER_HIGH = 1024 * 1024
const BUFFER_LOW = 256 * 1024

/** Waits for the browser to find its local addresses (we send no trickle candidates). */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve()
    const finish = () => {
      clearTimeout(timer)
      pc.removeEventListener("icegatheringstatechange", check)
      resolve()
    }
    const check = () => {
      if (pc.iceGatheringState === "complete") finish()
    }
    // Take what was found so far rather than hang on a slow interface.
    const timer = setTimeout(finish, GATHER_TIMEOUT_MS)
    pc.addEventListener("icegatheringstatechange", check)
  })
}

function makeLink(pc: RTCPeerConnection, handlers: LinkHandlers) {
  let channel: RTCDataChannel | null = null
  let ended = false

  const end = (reason: "closed" | "failed") => {
    if (ended) return
    ended = true
    handlers.onClose(reason)
  }

  const link: Link = {
    send(text) {
      if (channel?.readyState !== "open") throw new Error("Not connected.")
      channel.send(text)
    },
    async sendChunks(chunks) {
      const ch = channel
      if (ch?.readyState !== "open") throw new Error("Not connected.")
      ch.bufferedAmountLowThreshold = BUFFER_LOW
      for (const chunk of chunks) {
        if (ch.bufferedAmount > BUFFER_HIGH) {
          await new Promise<void>((resolve, reject) => {
            const low = () => {
              ch.removeEventListener("close", closed)
              resolve()
            }
            const closed = () => {
              ch.removeEventListener("bufferedamountlow", low)
              reject(new Error("The connection closed."))
            }
            ch.addEventListener("bufferedamountlow", low, { once: true })
            ch.addEventListener("close", closed, { once: true })
          })
        }
        if (ch.readyState !== "open") throw new Error("The connection closed.")
        // A copy: `send` wants a buffer view that owns its whole buffer.
        ch.send(chunk.slice())
      }
    },
    close() {
      channel?.close()
      pc.close()
      end("closed")
    },
  }

  const attach = (ch: RTCDataChannel) => {
    channel = ch
    ch.binaryType = "arraybuffer"
    ch.addEventListener("open", () => handlers.onOpen(link))
    ch.addEventListener("close", () => end("closed"))
    ch.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data
      if (typeof data === "string") handlers.onText(data)
      else if (data instanceof ArrayBuffer) {
        handlers.onBinary(new Uint8Array(data))
      }
    })
  }

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed") end("failed")
    else if (pc.connectionState === "closed") end("closed")
  })

  return { link, attach }
}

export interface Offer {
  link: Link
  /** Pairing code to show on this device. */
  code: string
  /** This device's session description (what the code carries). */
  localSdp: string
  /**
   * Applies the other device's answer code; the link opens a moment later.
   * Returns the other device's session description.
   */
  accept(answerCode: string): Promise<string>
}

/** The device that starts: makes the offer. */
export async function openOffer(
  handlers: LinkHandlers,
  options: RtcOptions = {}
): Promise<Offer> {
  const pc = new RTCPeerConnection(configFor(options))
  const { link, attach } = makeLink(pc, handlers)
  try {
    attach(pc.createDataChannel("glyph", { ordered: true }))
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error("Could not prepare a connection.")
    return {
      link,
      code: await encodePairing("offer", sdp),
      localSdp: sdp,
      async accept(answerCode) {
        const decoded = await decodePairing(answerCode)
        if (!decoded.ok) throw new Error(decoded.error)
        if (decoded.kind !== "answer") {
          throw new Error(
            "That is the other device's start code. Paste the reply the other device gave you after it used this code."
          )
        }
        await pc.setRemoteDescription({ type: "answer", sdp: decoded.sdp })
        return decoded.sdp
      },
    }
  } catch (error) {
    pc.close()
    throw error
  }
}

export interface Answer {
  link: Link
  /** Pairing code to show on this device. */
  code: string
  /** This device's session description, and the one it was given. */
  localSdp: string
  remoteSdp: string
}

/** The device that joins: reads the offer and makes the answer. */
export async function openAnswer(
  offerCode: string,
  handlers: LinkHandlers,
  options: RtcOptions = {}
): Promise<Answer> {
  const decoded = await decodePairing(offerCode)
  if (!decoded.ok) throw new Error(decoded.error)
  if (decoded.kind !== "offer") {
    throw new Error(
      "That is a reply code. Paste the start code from the other device instead."
    )
  }
  const pc = new RTCPeerConnection(configFor(options))
  const { link, attach } = makeLink(pc, handlers)
  try {
    pc.addEventListener("datachannel", (event) => attach(event.channel))
    await pc.setRemoteDescription({ type: "offer", sdp: decoded.sdp })
    await pc.setLocalDescription(await pc.createAnswer())
    await gathered(pc)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error("Could not prepare a connection.")
    return {
      link,
      code: await encodePairing("answer", sdp),
      localSdp: sdp,
      remoteSdp: decoded.sdp,
    }
  } catch (error) {
    pc.close()
    throw error
  }
}
