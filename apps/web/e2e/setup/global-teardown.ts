/** Playwright globalTeardown: stop the ephemeral Postgres and delete its data dir. */
import { stopCluster } from './pg'

export default async function globalTeardown(): Promise<void> {
  stopCluster()
}
