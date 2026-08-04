/**
 * tRPC HTTP entry point. Served (behind basePath) at /book/api/trpc/*.
 *
 * The Better Auth session is resolved here from the request cookies and its
 * user id passed into createContext — this is what lets staffProcedure and
 * customer-session resolution work at all.
 */

import { appRouter, createContext } from '@plunj/api'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { getAuth, getPayments, getSms, prisma } from '@/lib/trpc/server'

const handler = async (req: Request) => {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null)

  return fetchRequestHandler({
    // Next strips the '/book' basePath before invoking route handlers, so the
    // endpoint tRPC slices off the request path must NOT include it.
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        db: prisma,
        payments: getPayments(),
        sms: getSms(),
        auth,
        authUserId: session?.user?.id ?? null,
        authUserPhone:
          (session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber ?? null,
        ip:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
      }),
  })
}

export { handler as GET, handler as POST }
