import { describe, expect, it, vi } from 'vitest'
import type { InviteParseResult } from '@shared/invite'
import { findInviteLink, InviteLinks } from './invite-links'

const LINK =
  'ratatosk://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

describe('findInviteLink', () => {
  it('finds the link among Electron and Chromium arguments', () => {
    expect(findInviteLink(['/opt/Ratatosk/ratatosk', '--no-sandbox', LINK])).toBe(LINK)
    expect(findInviteLink(['C:\\Ratatosk.exe', '--', LINK.toUpperCase()])).toBe(LINK.toUpperCase())
  })

  it('returns null without a link', () => {
    expect(findInviteLink(['electron', '.', '--inspect'])).toBeNull()
  })
})

describe('InviteLinks', () => {
  it('holds a link that arrives before the renderer is ready', () => {
    const deliver = vi.fn()
    const links = new InviteLinks(deliver)

    links.receive(LINK)

    expect(deliver).not.toHaveBeenCalled()
    expect(links.takePending()).toMatchObject({ ok: true, invite: { roomId: 'vecherniy' } })
    expect(links.takePending()).toBeNull()
  })

  it('keeps only the latest early link', () => {
    const links = new InviteLinks(vi.fn())

    links.receive('ratatosk://join?v=2')
    links.receive(LINK)

    expect(links.takePending()?.ok).toBe(true)
  })

  it('delivers links directly once the renderer asked for pending ones', () => {
    const delivered: InviteParseResult[] = []
    const links = new InviteLinks((r) => delivered.push(r))
    links.takePending()

    links.receive(LINK)

    expect(delivered).toHaveLength(1)
    expect(links.takePending()).toBeNull()
  })

  it('holds links again while the renderer reloads', () => {
    const deliver = vi.fn()
    const links = new InviteLinks(deliver)
    links.takePending()

    links.rendererGone()
    links.receive(LINK)

    expect(deliver).not.toHaveBeenCalled()
    expect(links.takePending()?.ok).toBe(true)
  })

  it('passes broken links on as parse errors', () => {
    const links = new InviteLinks(vi.fn())

    links.receive('ratatosk://join?v=1&h=1.2.3')

    expect(links.takePending()).toEqual({
      ok: false,
      error: { code: 'invalid-host', param: 'h' },
    })
  })
})
