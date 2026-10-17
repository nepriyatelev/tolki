import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Invite } from '@shared/invite'
import type { RecentRoom } from '@shared/recent'

export const MAX_RECENT_ROOMS = 10

/** Encrypts saved passwords; Electron safeStorage in the app. */
export interface SecretBox {
  /** False when the OS gives no real encryption (e.g. Linux without a keyring). */
  readonly available: boolean
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

export interface RecentRoomsBackend {
  read(): unknown
  write(rooms: unknown): void
}

const storedSchema = z.array(
  z.object({
    id: z.string(),
    invite: z.object({
      host: z.string(),
      hostKind: z.enum(['ipv4', 'ipv6', 'dns']),
      port: z.number().int(),
      roomId: z.string(),
      fingerprint: z.string(),
    }),
    roomName: z.string(),
    lastUsedAt: z.number(),
    /** safeStorage ciphertext, base64. Never the password itself. */
    encryptedPassword: z.string().optional(),
  }),
)
type Stored = z.infer<typeof storedSchema>[number]

/** One entry per room: same host, port, certificate and room id. */
export function recentRoomId(invite: Omit<Invite, 'password'>): string {
  return createHash('sha256')
    .update([invite.host, invite.port, invite.fingerprint, invite.roomId].join('\n'))
    .digest('base64url')
    .slice(0, 16)
}

/**
 * Recent rooms on this device (PLAN #15). Passwords are kept only encrypted with the OS keychain
 * (safeStorage); without real encryption they are not kept at all.
 */
export class RecentRooms {
  #rooms: Stored[]

  constructor(
    private readonly backend: RecentRoomsBackend,
    private readonly secrets: SecretBox,
    private readonly now: () => number = Date.now,
  ) {
    const parsed = storedSchema.safeParse(backend.read())
    this.#rooms = parsed.success ? parsed.data : []
  }

  list(): RecentRoom[] {
    return this.#rooms.map(toPublic)
  }

  /** Records a successful join; moves the room to the top. */
  remember(invite: Invite, roomName: string, password: string | undefined): RecentRoom {
    const publicInvite = {
      host: invite.host,
      hostKind: invite.hostKind,
      port: invite.port,
      roomId: invite.roomId,
      fingerprint: invite.fingerprint,
    }
    const id = recentRoomId(publicInvite)
    const previous = this.#rooms.find((r) => r.id === id)
    const encryptedPassword =
      password && this.secrets.available
        ? this.secrets.encrypt(password)
        : password === ''
          ? undefined
          : previous?.encryptedPassword
    const entry: Stored = {
      id,
      invite: publicInvite,
      roomName,
      lastUsedAt: this.now(),
      ...(encryptedPassword !== undefined ? { encryptedPassword } : {}),
    }
    this.#rooms = [entry, ...this.#rooms.filter((r) => r.id !== id)].slice(0, MAX_RECENT_ROOMS)
    this.backend.write(this.#rooms)
    return toPublic(entry)
  }

  /** The decrypted password for a room, for main only. */
  password(id: string): string | undefined {
    const encrypted = this.#rooms.find((r) => r.id === id)?.encryptedPassword
    if (encrypted === undefined) return undefined
    try {
      return this.secrets.decrypt(encrypted)
    } catch {
      return undefined // keychain changed or entry damaged: ask the user again
    }
  }

  /** Forgets a saved password that turned out to be wrong. */
  forgetPassword(id: string): void {
    this.#rooms = this.#rooms.map((r) =>
      r.id === id
        ? { id: r.id, invite: r.invite, roomName: r.roomName, lastUsedAt: r.lastUsedAt }
        : r,
    )
    this.backend.write(this.#rooms)
  }

  remove(id: string): RecentRoom[] {
    this.#rooms = this.#rooms.filter((r) => r.id !== id)
    this.backend.write(this.#rooms)
    return this.list()
  }
}

function toPublic(room: Stored): RecentRoom {
  return {
    id: room.id,
    invite: { ...room.invite },
    roomName: room.roomName,
    lastUsedAt: room.lastUsedAt,
    passwordSaved: room.encryptedPassword !== undefined,
  }
}
