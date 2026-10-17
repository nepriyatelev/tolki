import Link from 'lucide-solid/icons/link'
import Plus from 'lucide-solid/icons/plus'
import type { JSX } from 'solid-js'
import { Card } from '../ui'
import { NetworkStatusBar } from './NetworkStatusBar'

// Placeholder home screen; the real one is built in issue #15.
export function HomeScreen(): JSX.Element {
  return (
    <>
      <main class="home">
        <h1>С кем созвонимся?</h1>
        <div class="home-cards">
          <Card as="section">
            <span class="home-card-icon home-card-icon--accent">
              <Plus />
            </span>
            <h2>Создать комнату</h2>
            <p>Твой компьютер станет хостом.</p>
          </Card>
          <Card as="section">
            <span class="home-card-icon">
              <Link />
            </span>
            <h2>Войти по ссылке</h2>
            <p>Вставь приглашение от друга.</p>
          </Card>
        </div>
      </main>
      <NetworkStatusBar />
    </>
  )
}
