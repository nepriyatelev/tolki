import type { JSX } from 'solid-js'
import { APP_NAME } from '@shared/app'
import logo from './assets/logo.svg'

// Placeholder home screen; the real one is built in issue #15.
export function App(): JSX.Element {
  return (
    <div class="app">
      <header class="app-header">
        <img class="app-logo" src={logo} alt="" width="36" height="36" />
        <span class="app-name">{APP_NAME}</span>
      </header>
      <main class="home">
        <h1>С кем созвонимся?</h1>
        <div class="home-cards">
          <section class="card">
            <h2>Создать комнату</h2>
            <p>Твой компьютер станет хостом.</p>
          </section>
          <section class="card">
            <h2>Войти по ссылке</h2>
            <p>Вставь приглашение от друга.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
