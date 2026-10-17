import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup()
})

// jsdom has <dialog> but not its modal API.
if (typeof HTMLDialogElement !== 'undefined' && !('showModal' in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true
    },
    close(this: HTMLDialogElement) {
      if (!this.open) return
      this.open = false
      this.dispatchEvent(new Event('close'))
    },
  })
}
