import Link from 'next/link'
import { TRPCReactProvider } from '@/lib/trpc/client'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCReactProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-16">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            className="text-xl font-bold tracking-[0.18em] text-ink"
            aria-label="PLUNJ home"
          >
            PLUNJ
          </Link>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </TRPCReactProvider>
  )
}
