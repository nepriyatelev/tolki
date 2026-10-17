import { z } from 'zod'

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
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = { speedTest: { enabled: true }, profile: { name: '' } }

/** Partial update from the renderer; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  speedTest: z.strictObject({ enabled: z.boolean() }).optional(),
  profile: z.strictObject({ name: z.string().trim().max(32) }).optional(),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
