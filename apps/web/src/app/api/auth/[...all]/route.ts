/**
 * Better Auth handler (phone-OTP only — no passwords anywhere).
 */

import { getAuth } from '@/lib/trpc/server'

const handler = (req: Request) => getAuth().handler(req)

export { handler as GET, handler as POST }
