import type { ScreenMode } from '@shared/screen'
import type { RadioPillOption } from '../ui'

/** What is shown, and so how it is sent (PLAN #27): the room's default and the sharer's pick. */
export const SCREEN_MODE_OPTIONS: readonly RadioPillOption<ScreenMode>[] = [
  { value: 'auto', label: 'Авто', description: 'Подстраивается под сеть' },
  { value: 'text', label: 'Чёткий текст', description: 'Код, документы · 15 к/с' },
  { value: 'motion', label: 'Плавно', description: 'Игры, видео · 60 к/с' },
]
