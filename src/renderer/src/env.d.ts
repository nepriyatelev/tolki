import type { RatatoskApi } from '@shared/ipc'

declare global {
  interface Window {
    readonly ratatosk: RatatoskApi
  }
}
