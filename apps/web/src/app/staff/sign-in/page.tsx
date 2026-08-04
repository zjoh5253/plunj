import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { SignInClient } from './sign-in-client'

export const metadata: Metadata = { title: 'Staff sign-in' }

export default function StaffSignInPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-16">
      <header className="flex items-center justify-between py-6">
        <span className="text-xl font-bold tracking-[0.18em] text-ink">PLUNJ</span>
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">Staff</span>
      </header>
      <main className="flex flex-1 flex-col justify-center pb-24">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <SignInClient />
        </Suspense>
      </main>
    </div>
  )
}
