import type { PermissionState } from '@shared/permissions'
import type { ScreenSourcesResult } from '@shared/screen'

/** Screen capture for the call; tests swap in a fake. */
export interface ScreenAccess {
  listSources(): Promise<ScreenSourcesResult>
  /**
   * Starts capturing the source picked in our dialog (null: the system picker chooses);
   * `systemAudio`: with the computer's sound (#41).
   */
  capture(sourceId: string | null, systemAudio: boolean): Promise<MediaStream>
  /** macOS «Запись экрана» (#85): 'not-asked' — explain before macOS asks. */
  permission(): Promise<PermissionState>
  openPermissionSettings(): Promise<void>
  /** macOS applies «Запись экрана» only after a restart. */
  relaunch(): Promise<void>
}

export class ScreenCaptureError extends Error {
  override name = 'ScreenCaptureError'
}

export const browserScreen: ScreenAccess = {
  listSources: () => window.tolki.screen.listSources(),

  async capture(sourceId, systemAudio) {
    // Main hands exactly this source to getDisplayMedia(); see setDisplayMediaRequestHandler.
    if (sourceId !== null && !(await window.tolki.screen.select(sourceId))) {
      throw new ScreenCaptureError('the source is gone')
    }
    return navigator.mediaDevices.getDisplayMedia({
      video: true,
      // The computer's sound as it plays: no voice processing, stereo — and without Tolki's
      // own sound, or everyone would hear the call back from this computer.
      audio: systemAudio
        ? ({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            restrictOwnAudio: true,
          } as MediaTrackConstraints)
        : false,
    })
  },

  permission: () => window.tolki.permissions.status('screen'),

  async openPermissionSettings() {
    await window.tolki.permissions.openSettings('screen')
  },

  async relaunch() {
    await window.tolki.app.relaunch()
  },
}
