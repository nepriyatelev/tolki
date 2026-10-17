import { z } from 'zod'

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
      /**
       * Volume of each participant in percent (PLAN #23), keyed by `volumeKey(name)`: the same
       * friend keeps their volume in every room. Absent means 100 %.
       */
      peerVolumes: peerVolumesSchema.default({}),
    })
    .default({ inputDeviceId: '', peerVolumes: {} }),
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  speedTest: { enabled: true },
  profile: { name: '' },
  audio: { inputDeviceId: '', peerVolumes: {} },
}

/** Partial update from the renderer; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  speedTest: z.strictObject({ enabled: z.boolean() }).optional(),
  profile: z.strictObject({ name: z.string().trim().max(32) }).optional(),
  audio: z
    .strictObject({
      inputDeviceId: z.string().max(256).optional(),
      /** Merged into the saved volumes; 100 forgets the entry. */
      peerVolumes: z.record(z.string().trim().min(1).max(32), peerVolumeSchema).optional(),
    })
    .optional(),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
