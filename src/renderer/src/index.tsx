import '@fontsource-variable/onest'
import '@fontsource-variable/jetbrains-mono'
import './ui/tokens.css'
import './ui/base.css'
import { lazy } from 'solid-js'
import { render } from 'solid-js/web'
import { App } from './App'

// Dev-only component showcase at #ui-kit; not included in production builds.
const UiKit = import.meta.env.DEV ? lazy(() => import('./dev/UiKit')) : undefined

const root = document.getElementById('root')
if (!root) throw new Error('#root element is missing')

render(() => (UiKit && window.location.hash === '#ui-kit' ? <UiKit /> : <App />), root)
