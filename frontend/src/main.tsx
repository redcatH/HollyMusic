import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './components/AppRouter'
import { App } from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { ServiceWorkerRegister } from './components/ServiceWorkerRegister'
import { SiteMetadata } from './components/SiteMetadata'
import './globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ServiceWorkerRegister />
      <AppRouter>
        <SiteMetadata />
        <App />
      </AppRouter>
    </ThemeProvider>
  </StrictMode>,
)
