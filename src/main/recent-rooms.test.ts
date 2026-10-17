import { describe, expect, it } from 'vitest'
import type { Invite } from '@shared/invite'
import { MAX_RECENT_ROOMS, RecentRooms, recentRoomId, type SecretBox } from './recent-rooms'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const invite = (roomId: string, extra: Partial<Invite> = {}): Invite => ({
  host: '203.0.113.5',
  hostKind: 'ipv4',
  port: 47000,
  roomId,
  fingerprint: FP,
  ...extra,
})

/** Reversible stand-in for safeStorage that never contains the plaintext. */
const fakeBox = (available = true): SecretBox => ({
  available,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('hex')}`,
  decrypt: (encrypted) => Buffer.from(encrypted.replace(/^enc:/, ''), 'hex').toString(),
})

function setup(options: { available?: boolean; initial?: unknown } = {}) {
  let stored: unknown = options.initial
  let now = 1_000
  const rooms = new RecentRooms(
    {
      read: () => stored,
      write: (value) => {
        stored = JSON.parse(JSON.stringify(value))
      },
    },
    fakeBox(options.available),
    () => now,
  )
  return {
    rooms,
    stored: () => stored,
    tick: () => {
      now += 1000
    },
  }
}

describe('RecentRooms', () => {
  it('remembers a joined room without the password in the public list', () => {
    const { rooms } = setup()

    const room = rooms.remember(invite('a', { password: 'from-link' }), 'Вечерний созвон', 'secret')

    expect(room).toEqual({
      id: recentRoomId(invite('a')),
      invite: invite('a'),
      roomName: 'Вечерний созвон',
      lastUsedAt: 1_000,
      passwordSaved: true,
    })
    expect(JSON.stringify(rooms.list())).not.toContain('secret')
  })

  it('stores the password only encrypted, and decrypts it for main', () => {
    const { rooms, stored } = setup()
    const { id } = rooms.remember(invite('a'), 'Комната', 'лиса-маяк-42')

    expect(JSON.stringify(stored())).not.toContain('лиса-маяк-42')
    expect(rooms.password(id)).toBe('лиса-маяк-42')
  })

  it('does not keep passwords when the OS offers no real encryption', () => {
    const { rooms, stored } = setup({ available: false })

    const room = rooms.remember(invite('a'), 'Комната', 'secret')

    expect(room.passwordSaved).toBe(false)
    expect(JSON.stringify(stored())).not.toContain('secret')
  })

  it('keeps one entry per room, newest first, at most 10', () => {
    const { rooms, tick } = setup()
    for (let i = 0; i < MAX_RECENT_ROOMS + 3; i++) {
      rooms.remember(invite(`r${i}`), `Комната ${i}`, undefined)
      tick()
    }
    rooms.remember(invite('r5'), 'Комната 5 снова', undefined)

    const list = rooms.list()
    expect(list).toHaveLength(MAX_RECENT_ROOMS)
    expect(list[0]?.roomName).toBe('Комната 5 снова')
    expect(list.filter((r) => r.invite.roomId === 'r5')).toHaveLength(1)
  })

  it('keeps a saved password when rejoining without one, drops it for an open room', () => {
    const { rooms } = setup()
    const { id } = rooms.remember(invite('a'), 'Комната', 'secret')

    rooms.remember(invite('a'), 'Комната', undefined)
    expect(rooms.password(id)).toBe('secret')

    rooms.remember(invite('a'), 'Комната', '')
    expect(rooms.password(id)).toBeUndefined()
  })

  it('forgets a password that turned out to be wrong', () => {
    const { rooms } = setup()
    const { id } = rooms.remember(invite('a'), 'Комната', 'old')

    rooms.forgetPassword(id)

    expect(rooms.password(id)).toBeUndefined()
    expect(rooms.list()[0]?.passwordSaved).toBe(false)
  })

  it('returns undefined if the stored password cannot be decrypted', () => {
    const rooms = new RecentRooms(
      { read: () => undefined, write: () => undefined },
      {
        ...fakeBox(),
        decrypt: () => {
          throw new Error('keychain changed')
        },
      },
    )
    const { id } = rooms.remember(invite('a'), 'Комната', 'secret')

    expect(rooms.password(id)).toBeUndefined()
  })

  it('removes a room', () => {
    const { rooms } = setup()
    const { id } = rooms.remember(invite('a'), 'A', undefined)
    rooms.remember(invite('b'), 'B', undefined)

    expect(rooms.remove(id).map((r) => r.roomName)).toEqual(['B'])
  })

  it('ignores a damaged file', () => {
    const { rooms } = setup({ initial: [{ id: 1, nonsense: true }] })

    expect(rooms.list()).toEqual([])
  })
})
