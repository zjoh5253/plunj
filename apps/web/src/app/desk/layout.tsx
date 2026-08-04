import type { Metadata } from 'next'
import { TRPCReactProvider } from '@/lib/trpc/client'

export const metadata: Metadata = {
  title: {
    default: 'PLUNJ Desk',
    template: '%s — PLUNJ Desk',
  },
  // Route-scoped PWA manifest served by src/app/desk/manifest.webmanifest/route.ts
  manifest: '/book/desk/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'PLUNJ Desk',
    statusBarStyle: 'black',
  },
}

export default function DeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCReactProvider>
      <div className="flex min-h-dvh flex-col bg-paper">{children}</div>
    </TRPCReactProvider>
  )
}
