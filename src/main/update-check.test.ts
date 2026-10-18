import { describe, expect, it, vi } from 'vitest'
import {
  isNewer,
  LATEST_RELEASE_API,
  parseVersion,
  UpdateCheck,
  type UpdateCheckOptions,
} from './update-check'

const answer = (body: unknown, status = 200) =>
  vi.fn<UpdateCheckOptions['fetch']>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )

describe('versions', () => {
  it('reads tags with or without «v»', () => {
    expect(parseVersion('v0.2.0')).toEqual([0, 2, 0])
    expect(parseVersion('1.10.3')).toEqual([1, 10, 3])
    expect(parseVersion('v1.0.0-beta.1')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('compares part by part, not as text', () => {
    expect(isNewer('v0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('v0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.1.0', '0.2.0')).toBe(false)
    expect(isNewer('nonsense', '0.1.0')).toBe(false)
  })
})

describe('UpdateCheck (#36)', () => {
  it('reports a newer release', async () => {
    const fetch = answer({ tag_name: 'v0.2.0', body: 'whatever' })
    const check = new UpdateCheck({ enabled: true, currentVersion: '0.1.0', fetch })
    expect(await check.check()).toEqual({ version: '0.2.0' })
    expect(fetch).toHaveBeenCalledWith(LATEST_RELEASE_API, expect.anything())
  })

  it('asks GitHub once per run', async () => {
    const fetch = answer({ tag_name: 'v0.2.0' })
    const check = new UpdateCheck({ enabled: true, currentVersion: '0.1.0', fetch })
    await check.check()
    await check.check()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for the same or an older release, and on any failure', async () => {
    const same = new UpdateCheck({
      enabled: true,
      currentVersion: '0.2.0',
      fetch: answer({ tag_name: 'v0.2.0' }),
    })
    expect(await same.check()).toBeNull()
    const missing = new UpdateCheck({
      enabled: true,
      currentVersion: '0.1.0',
      fetch: answer({ message: 'Not Found' }, 404),
    })
    expect(await missing.check()).toBeNull()
    const offline = new UpdateCheck({
      enabled: true,
      currentVersion: '0.1.0',
      fetch: () => Promise.reject(new Error('offline')),
    })
    expect(await offline.check()).toBeNull()
    const garbage = new UpdateCheck({
      enabled: true,
      currentVersion: '0.1.0',
      fetch: () => Promise.resolve(new Response('<html>')),
    })
    expect(await garbage.check()).toBeNull()
  })

  it('never contacts GitHub when off', async () => {
    const fetch = answer({ tag_name: 'v9.0.0' })
    const check = new UpdateCheck({ enabled: false, currentVersion: '0.1.0', fetch })
    expect(await check.check()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
