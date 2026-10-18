import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateOffer } from '@shared/ipc'
import { AutoUpdate, type Updater } from './auto-update'

class FakeUpdater extends EventEmitter implements Updater {
  checkForUpdates = vi.fn(() => Promise.resolve(null))
  quitAndInstall = vi.fn()
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function setup(updater: FakeUpdater | null, latest: { version: string } | null = null) {
  const changes: UpdateOffer[] = []
  const fallback = vi.fn(() => Promise.resolve(latest))
  const auto = new AutoUpdate({ updater, fallback, onChange: (o) => changes.push(o), log })
  return { auto, changes, fallback }
}

describe('AutoUpdate (#46)', () => {
  it('without an updater offers the download page, as before (#36)', async () => {
    const { auto, fallback } = setup(null, { version: '0.2.0' })
    expect(await auto.offer()).toEqual({ version: '0.2.0', ready: false })
    expect(fallback).toHaveBeenCalledOnce()
    expect(auto.install()).toBe(false)
  })

  it('checks once, downloads in the background, then offers the restart', async () => {
    const updater = new FakeUpdater()
    const { auto, changes, fallback } = setup(updater)
    expect(await auto.offer()).toBeNull()
    await auto.offer()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(auto.install()).toBe(false)

    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(changes).toEqual([{ version: '0.2.0', ready: true }])
    expect(await auto.offer()).toEqual({ version: '0.2.0', ready: true })
    expect(fallback).not.toHaveBeenCalled()

    expect(auto.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('falls back to the download page when the updater fails', async () => {
    const updater = new FakeUpdater()
    updater.checkForUpdates.mockImplementation(() => {
      updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
      return Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))
    })
    const { auto, changes } = setup(updater, { version: '0.2.0' })
    await auto.offer()
    await vi.waitFor(() => {
      expect(changes).toEqual([{ version: '0.2.0', ready: false }])
    })
    expect(auto.install()).toBe(false)
  })

  it('keeps a downloaded version over a later error', async () => {
    const updater = new FakeUpdater()
    const { auto, fallback } = setup(updater, { version: '0.2.0' })
    await auto.offer()
    updater.emit('update-downloaded', { version: '0.3.0' })
    updater.emit('error', new Error('later'))
    expect(fallback).not.toHaveBeenCalled()
    expect(await auto.offer()).toEqual({ version: '0.3.0', ready: true })
  })
})
