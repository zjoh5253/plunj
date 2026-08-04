import { notFound } from 'next/navigation'
import { DeskTopBar } from '@/components/desk/top-bar'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export default async function DeskLocationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const caller = await getCaller()
  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  return (
    <>
      <DeskTopBar
        location={{
          slug: location.slug,
          name: location.name,
          city: location.city,
          timezone: location.timezone,
        }}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-32 pt-5">{children}</main>
    </>
  )
}
