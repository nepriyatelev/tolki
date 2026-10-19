import { expect, test } from '@playwright/test'
import { launchApp, launchSecondInstance } from './app'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const link = (host: string, room: string) =>
  `tolki://join?v=1&h=${host}&p=47000&r=${room}&fp=${FP}&k=secret`

test('a link that starts the app opens "Вход по ссылке" with its data', async () => {
  const { app, page } = await launchApp({ args: [link('203.0.113.5', 'vecherniy')] })
  try {
    // Nobody hosts 203.0.113.5 in tests: the screen says so and still shows the link's data.
    await expect(page.getByRole('heading', { name: 'Вход по ссылке' })).toBeVisible()
    // The address sits under «Подробнее о подключении» (#110).
    await page.getByText('Подробнее о подключении').click()
    await expect(page.getByText('203.0.113.5:47000')).toBeVisible()
    await expect(page.getByText('Организатор сейчас не в сети')).toBeVisible()
    await expect(page.getByText('Пароль вшит в ссылку')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('a second launch with a link quits and hands the link to the running app', async () => {
  const { app, page, userDataDir } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: 'Tolki' })).toBeVisible()

    const exitCode = await launchSecondInstance(userDataDir, [
      link('%5B2a02%3A6b8%3A%3A1%5D', 'kino'),
    ])

    expect(exitCode).toBe(0)
    await expect(page.getByRole('heading', { name: 'Вход по ссылке' })).toBeVisible()
    await page.getByText('Подробнее о подключении').click()
    await expect(page.getByText('[2a02:6b8::1]:47000')).toBeVisible()
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('a link from a newer version asks to update the app', async () => {
  const { app, page } = await launchApp({ args: ['tolki://join?v=9'] })
  try {
    await expect(page.getByRole('heading', { name: 'Нужна новая версия' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скачать новую версию' })).toBeVisible()
    await page.getByRole('button', { name: 'На главный экран' }).click()
    await expect(page.getByRole('heading', { name: 'Tolki' })).toBeVisible()
  } finally {
    await app.close()
  }
})
