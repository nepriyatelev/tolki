import { describe, expect, it } from 'vitest'
import { measureUpload } from './speed-test'

/** A fake link: every POST takes rtt + size / rate on a virtual clock. */
function fakeLink(options: { mbps: number; rttMs: number; status?: number }) {
  let clock = 0
  const sizes: number[] = []
  const fetch = (_url: string, init: RequestInit): Promise<Response> => {
    const size = (init.body as Uint8Array).byteLength
    sizes.push(size)
    clock += options.rttMs + (size * 8) / (options.mbps * 1000)
    return Promise.resolve(new Response('ok', { status: options.status ?? 200 }))
  }
  return { fetch, now: () => clock, sizes }
}

describe('measureUpload', () => {
  it.each([
    [92, 40],
    [10, 25],
    [1.5, 80],
  ])('measures a %s Mbit/s link (rtt %s ms) accurately', async (mbps, rttMs) => {
    const link = fakeLink({ mbps, rttMs })

    const result = await measureUpload({
      fetch: link.fetch,
      now: link.now,
      maxBytes: 8 * 1024 * 1024,
      parallel: 1,
    })

    expect(result.mbps).toBeCloseTo(mbps, 0)
  })

  it('grows the upload until one is long enough, then stops', async () => {
    const link = fakeLink({ mbps: 50, rttMs: 20 })

    await measureUpload({ fetch: link.fetch, now: link.now, targetRequestMs: 1000, parallel: 1 })

    const sizes = link.sizes.slice(2) // after the two empty RTT probes
    expect(sizes[0]).toBe(256 * 1024)
    expect(sizes.every((size, i) => i === 0 || size === (sizes[i - 1] ?? 0) * 2)).toBe(true)
    // The last upload took at least the target time; the one before did not.
    const last = sizes.at(-1) ?? 0
    expect(20 + (last * 8) / 50_000).toBeGreaterThanOrEqual(1000)
    expect(20 + (last * 4) / 50_000).toBeLessThan(1000)
  })

  it('stays within the time budget on a slow link', async () => {
    const link = fakeLink({ mbps: 0.5, rttMs: 100 })

    await measureUpload({
      fetch: link.fetch,
      now: link.now,
      budgetMs: 3000,
      targetRequestMs: 60_000,
      parallel: 1,
    })

    // 256 KiB at 0.5 Mbit/s already takes ~4 s: no second upload starts after the budget.
    expect(link.sizes.slice(2)).toEqual([256 * 1024])
  })

  it('sends random bytes so compression cannot fake a fast link', async () => {
    let body: Uint8Array | undefined
    const link = fakeLink({ mbps: 50, rttMs: 10 })
    await measureUpload({
      fetch: (url, init) => {
        if ((init.body as Uint8Array).byteLength > 0) body = init.body as Uint8Array
        return link.fetch(url, init)
      },
      now: link.now,
      maxBytes: 1024 * 1024,
    })

    const zeros = Array.from(body ?? []).filter((b) => b === 0).length
    expect(zeros / (body?.length ?? 1)).toBeLessThan(0.01)
  })

  it('uploads in parallel rounds and counts all bytes of a round', async () => {
    const link = fakeLink({ mbps: 40, rttMs: 0 })

    // The fake link serialises transfers, so 4 parallel uploads share the same 40 Mbit/s.
    const result = await measureUpload({ fetch: link.fetch, now: link.now, parallel: 4 })

    const rounds = link.sizes.slice(2)
    expect(rounds.length % 4).toBe(0)
    expect(rounds.slice(0, 4)).toEqual(Array(4).fill(256 * 1024))
    expect(result.mbps).toBeCloseTo(40, 0)
  })

  it('fails on server errors', async () => {
    const link = fakeLink({ mbps: 50, rttMs: 10, status: 503 })

    await expect(measureUpload({ fetch: link.fetch, now: link.now })).rejects.toThrow('503')
  })
})
