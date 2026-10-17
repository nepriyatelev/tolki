import type { Invite } from './invite'

/** A room this device joined before (PLAN #15). Kept only on this device. */
export interface RecentRoom {
  id: string
  /** Without the password: that is stored encrypted in main and never sent to the renderer. */
  invite: Omit<Invite, 'password'>
  roomName: string
  lastUsedAt: number
  passwordSaved: boolean
}

/** Result of a light check (hello → challenge, no authentication): only the number of people. */
export type RecentStatus =
  | { status: 'live'; peerCount: number }
  | { status: 'offline' }
  /** The host answered with a different certificate than the one in the link. */
  | { status: 'certificate-changed' }
