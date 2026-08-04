import { createCallerFactory, router } from '../trpc.js'
import { adminRouter } from './admin.js'
import { deskRouter } from './desk.js'
import { publicRouter } from './public.js'

export const appRouter = router({
  public: publicRouter,
  desk: deskRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter

/** Server-side caller: `const caller = createCaller(await createContext({...}))`. */
export const createCaller = createCallerFactory(appRouter)
