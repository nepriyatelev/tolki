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

// jsdom hides [popover] but has no popover API: enough of it for menus that use showPopover().
if (!('showPopover' in HTMLElement.prototype)) {
  const opened = new WeakSet<HTMLElement>()
  const toggle = (element: HTMLElement, open: boolean): void => {
    if (opened.has(element) === open) return
    if (open) opened.add(element)
    else opened.delete(element)
    element.style.display = open ? 'block' : ''
    element.dispatchEvent(
      Object.assign(new Event('toggle'), { newState: open ? 'open' : 'closed' }),
    )
  }
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      toggle(this, true)
    },
    hidePopover(this: HTMLElement) {
      toggle(this, false)
    },
  })
}
