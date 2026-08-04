'use client'

/**
 * Better Auth browser client for staff phone-OTP sign-in. Lives under
 * components/desk (not lib/) because lib/ is shared surface. The auth handler
 * is served behind the app's /book basePath at /book/api/auth.
 */

import { createAuthClient } from 'better-auth/react'
import { phoneNumberClient } from 'better-auth/client/plugins'

const baseURL =
  typeof window === 'undefined'
    ? 'http://localhost:3000/book/api/auth'
    : `${window.location.origin}/book/api/auth`

export const authClient = createAuthClient({
  baseURL,
  plugins: [phoneNumberClient()],
})
