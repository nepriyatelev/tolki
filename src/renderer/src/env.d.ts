import type { TolkiApi } from '@shared/ipc'

declare global {
  interface Window {
    readonly tolki: TolkiApi
  }

  // Chromium has AudioContext.setSinkId (output device) since 110; TypeScript's DOM types not yet.
  interface AudioContext {
    readonly sinkId: string
    setSinkId(sinkId: string): Promise<void>
  }
}
