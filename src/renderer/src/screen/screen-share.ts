import type { ScreenSourcesResult } from '@shared/screen'

/** Screen capture for the call; tests swap in a fake. */
export interface ScreenAccess {
  listSources(): Promise<ScreenSourcesResult>
  /** Starts capturing the source picked in our dialog (null: the system picker chooses). */
  capture(sourceId: string | null): Promise<MediaStream>
  openPermissionSettings(): Promise<void>
}

export class ScreenCaptureError extends Error {
  override name = 'ScreenCaptureError'
}

export const browserScreen: ScreenAccess = {
  listSources: () => window.ratatosk.screen.listSources(),

  async capture(sourceId) {
    // Main hands exactly this source to getDisplayMedia(); see setDisplayMediaRequestHandler.
    if (sourceId !== null && !(await window.ratatosk.screen.select(sourceId))) {
      throw new ScreenCaptureError('the source is gone')
    }
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  },

  async openPermissionSettings() {
    await window.ratatosk.screen.openPermissionSettings()
  },
}
