import { loadLocation } from '@/components/admin/load-location'
import { AdminShell } from '@/components/admin/shell'
import { TRPCReactProvider } from '@/lib/trpc/client'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return (
    <TRPCReactProvider>
      <AdminShell locationSlug={location.slug} locationName={location.name}>
        {children}
      </AdminShell>
    </TRPCReactProvider>
  )
}
