import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ClerkProvider } from '@clerk/clerk-react'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const SHOULD_BYPASS_CLERK = import.meta.env.DEV && !PUBLISHABLE_KEY

if (!SHOULD_BYPASS_CLERK && !PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {SHOULD_BYPASS_CLERK ? (
      <App />
    ) : (
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
      >
        <App />
      </ClerkProvider>
    )}
  </StrictMode>,
)
