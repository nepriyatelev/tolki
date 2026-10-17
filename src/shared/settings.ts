import { z } from 'zod'

export const settingsSchema = z.object({
  speedTest: z.object({
    /** Measure upload with speed.cloudflare.com before a call (PLAN #10). */
    enabled: z.boolean(),
  }),
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = { speedTest: { enabled: true } }

/** Partial update from the renderer; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  speedTest: z.strictObject({ enabled: z.boolean() }).optional(),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
