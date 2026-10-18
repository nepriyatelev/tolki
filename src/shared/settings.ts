import { z } from 'zod'
import { isHotkeyAccelerator } from './global-hotkeys'
import { DEFAULT_PUSH_TO_TALK_KEY, isPushToTalkKey } from './push-to-talk'

/** A global hotkey, or '' to clear it. */
const hotkeySchema = z.string().refine((value) => value === '' || isHotkeyAccelerator(value))

export const MAX_PEER_VOLUME = 200
/** Remembered volumes are a convenience; old entries go once there are this many. */
export const MAX_REMEMBERED_VOLUMES = 200

const peerVolumeSchema = z.number().int().min(0).max(MAX_PEER_VOLUME)
const peerVolumesSchema = z
  .record(z.string().min(1).max(32), peerVolumeSchema)
  .refine((volumes) => Object.keys(volumes).length <= MAX_REMEMBERED_VOLUMES)

/** Names differ in case and spaces between rooms; the volume should not. */
export function volumeKey(name: string): string {
  return name.trim().toLocaleLowerCase('ru')
}

// Every section has a default, so settings saved by an older version still load.
export const settingsSchema = z.object({
  speedTest: z
    .object({
      /** Measure upload with speed.cloudflare.com before a call (PLAN #10). */
      enabled: z.boolean(),
    })
    .default({ enabled: true }),
  profile: z
    .object({
      /** Name others see; remembered from the last successful join. Empty: not set yet. */
      name: z.string().max(32),
    })
    .default({ name: '' }),
  audio: z
    .object({
      /** Chosen microphone; empty: the system default. */
      inputDeviceId: z.string().max(256),
      /** Chosen speakers or headphones; empty: the system default. */
      outputDeviceId: z.string().max(256).default(''),
      /**
       * Volume of each participant in percent (PLAN #23), keyed by `volumeKey(name)`: the same
       * friend keeps their volume in every room. Absent means 100 %.
       */
      peerVolumes: peerVolumesSchema.default({}),
    })
    .default({ inputDeviceId: '', outputDeviceId: '', peerVolumes: {} }),
  pushToTalk: z
    .object({
      /** Talk only while the key is held (PLAN #39); off: the microphone button decides. */
      enabled: z.boolean(),
      /** KeyboardEvent.code of the key: the physical key, the same on every layout. */
      key: z.string().max(32),
    })
    .default({ enabled: false, key: DEFAULT_PUSH_TO_TALK_KEY }),
  /** Hotkeys that work in any window during a call (PLAN #40); empty: not set (the default). */
  globalHotkeys: z
    .object({
      mute: z.string().max(48),
      deafen: z.string().max(48),
    })
    .default({ mute: '', deafen: '' }),
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  speedTest: { enabled: true },
  profile: { name: '' },
  audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: {} },
  pushToTalk: { enabled: false, key: DEFAULT_PUSH_TO_TALK_KEY },
  globalHotkeys: { mute: '', deafen: '' },
}

/** Partial update from the renderer; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  speedTest: z.strictObject({ enabled: z.boolean() }).optional(),
  profile: z.strictObject({ name: z.string().trim().max(32) }).optional(),
  audio: z
    .strictObject({
      inputDeviceId: z.string().max(256).optional(),
      outputDeviceId: z.string().max(256).optional(),
      /** Merged into the saved volumes; 100 forgets the entry. */
      peerVolumes: z.record(z.string().trim().min(1).max(32), peerVolumeSchema).optional(),
    })
    .optional(),
  pushToTalk: z
    .strictObject({
      enabled: z.boolean().optional(),
      key: z.string().refine(isPushToTalkKey, 'not a push-to-talk key').optional(),
    })
    .optional(),
  globalHotkeys: z
    .strictObject({
      mute: hotkeySchema.optional(),
      deafen: hotkeySchema.optional(),
    })
    .optional(),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
