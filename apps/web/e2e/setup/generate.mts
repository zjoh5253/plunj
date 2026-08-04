/**
 * Session generation for the E2E database. Run with tsx and DATABASE_URL set
 * (see global-setup.ts) — uses @plunj/availability's generateSessions directly
 * against the seeded Provo location with a short ~3-day horizon.
 */
import { generateSessions } from '@plunj/availability'
import { prisma } from '@plunj/db'

const provo = await prisma.location.findUniqueOrThrow({ where: { slug: 'provo' } })
const result = await generateSessions(prisma, {
  locationId: provo.id,
  horizonDays: 3,
  now: new Date(),
})
console.log(`[e2e] generated sessions for ${provo.slug}: ${JSON.stringify(result)}`)
await prisma.$disconnect()
