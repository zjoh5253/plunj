'use client'

/**
 * Client-side staff auth guard. The API enforces staffProcedure server-side;
 * this hook just turns an UNAUTHORIZED response into a redirect to
 * /staff/sign-in?next=<current path> (the ?next= contract shared with admin).
 */

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function isUnauthorized(err: unknown): boolean {
  return (err as { data?: { code?: string } | null } | null)?.data?.code === 'UNAUTHORIZED'
}

export function useStaffGuard(...errors: unknown[]): void {
  const router = useRouter()
  const pathname = usePathname()
  const hit = errors.some((e) => e != null && isUnauthorized(e))
  useEffect(() => {
    if (hit) {
      router.replace(`/staff/sign-in?next=${encodeURIComponent(pathname)}`)
    }
  }, [hit, pathname, router])
}
