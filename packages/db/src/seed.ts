/**
 * Idempotent seed for local/dev databases: `pnpm --filter @plunj/db db:seed`.
 * Every write is an upsert (or find-or-create where no natural key exists),
 * so re-running always converges to the same state.
 */
import { createHash } from 'node:crypto'
import { id, prisma } from './index.js'
import {
  LIABILITY_WAIVER_MARKDOWN,
  MINOR_CONSENT_MARKDOWN,
  PRIVACY_POLICY_MARKDOWN,
} from './waiver-content.js'

const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z')

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function hourToLocalTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** dayOfWeek (0 = Sunday … 6 = Saturday) → hourly start times matching real Provo hours. */
function startHoursForDay(dayOfWeek: number): number[] {
  // Mon–Fri 06:00–22:00 → last start 21:00; Sat 07:00–21:00 → last 20:00; Sun 08:00–20:00 → last 19:00
  const [open, lastStart] = dayOfWeek === 0 ? [8, 19] : dayOfWeek === 6 ? [7, 20] : [6, 21]
  return Array.from({ length: lastStart - open + 1 }, (_, i) => open + i)
}

async function main() {
  // --- Organization (single row) ---------------------------------------------
  const org =
    (await prisma.organization.findFirst({ where: { name: 'PLUNJ' } })) ??
    (await prisma.organization.create({ data: { id: id(), name: 'PLUNJ' } }))

  // --- Provo location --------------------------------------------------------
  const provoData = {
    orgId: org.id,
    name: 'PLUNJ Provo',
    timezone: 'America/Denver',
    address1: '3768 N University Ave Ste 101',
    city: 'Provo',
    state: 'UT',
    postalCode: '84604',
    phone: '+13854526505',
    email: 'provo@plunj.co',
    status: 'ACTIVE',
    taxRateBps: 725,
    bookingProvider: 'INTERNAL',
  } as const
  const provo = await prisma.location.upsert({
    where: { slug: 'provo' },
    create: { id: id(), slug: 'provo', settings: {}, ...provoData },
    update: provoData,
  })

  // --- Contrast suite studio -------------------------------------------------
  const studio =
    (await prisma.studio.findFirst({
      where: { locationId: provo.id, name: 'Contrast Suite' },
    })) ??
    (await prisma.studio.create({
      data: {
        id: id(),
        locationId: provo.id,
        name: 'Contrast Suite',
        kind: 'CONTRAST_SUITE',
        defaultCapacity: 8,
        active: true,
      },
    }))

  // --- Hourly session templates matching real hours --------------------------
  let templateCount = 0
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    for (const hour of startHoursForDay(dayOfWeek)) {
      const startTimeLocal = hourToLocalTime(hour)
      await prisma.sessionTemplate.upsert({
        where: {
          studioId_dayOfWeek_startTimeLocal_effectiveFrom: {
            studioId: studio.id,
            dayOfWeek,
            startTimeLocal,
            effectiveFrom: EFFECTIVE_FROM,
          },
        },
        create: {
          id: id(),
          studioId: studio.id,
          locationId: provo.id,
          dayOfWeek,
          startTimeLocal,
          durationMin: 60,
          offeringType: 'COMMUNAL',
          priceCents: 4500,
          effectiveFrom: EFFECTIVE_FROM,
          active: true,
        },
        update: { priceCents: 4500, offeringType: 'COMMUNAL', active: true },
      })
      templateCount++
    }
  }

  // --- Buyout options --------------------------------------------------------
  const buyouts = [
    { durationHours: 1, priceCents: 21000, maxGuests: 8 },
    { durationHours: 2, priceCents: 38500, maxGuests: 12 },
  ]
  for (const buyout of buyouts) {
    const existing = await prisma.buyoutOption.findFirst({
      where: { locationId: provo.id, durationHours: buyout.durationHours },
    })
    if (existing) {
      await prisma.buyoutOption.update({
        where: { id: existing.id },
        data: { priceCents: buyout.priceCents, maxGuests: buyout.maxGuests, active: true },
      })
    } else {
      await prisma.buyoutOption.create({
        data: { id: id(), locationId: provo.id, active: true, ...buyout },
      })
    }
  }

  // --- Waiver documents (real PLUNJ content, see waiver-content.ts) -----------
  const waivers = [
    { kind: 'LIABILITY', title: 'Waiver and Release of Liability', body: LIABILITY_WAIVER_MARKDOWN },
    { kind: 'MINOR_CONSENT', title: 'Parent / Guardian Consent', body: MINOR_CONSENT_MARKDOWN },
    { kind: 'PRIVACY', title: 'Privacy Policy', body: PRIVACY_POLICY_MARKDOWN },
  ] as const
  for (const waiver of waivers) {
    await prisma.waiverDocument.upsert({
      where: {
        locationId_kind_version: { locationId: provo.id, kind: waiver.kind, version: 1 },
      },
      create: {
        id: id(),
        locationId: provo.id,
        kind: waiver.kind,
        version: 1,
        title: waiver.title,
        bodyMarkdown: waiver.body,
        contentSha256: sha256(waiver.body),
        publishedAt: new Date(),
        active: true,
      },
      update: {
        title: waiver.title,
        bodyMarkdown: waiver.body,
        contentSha256: sha256(waiver.body),
      },
    })
  }

  // --- Discount codes for testing --------------------------------------------
  const discountCodes = [
    { code: 'WELCOME20', type: 'PERCENT', valueBps: 2000 },
    { code: 'FIRSTTIMER', type: 'PERCENT', valueBps: 5000 },
    { code: 'TENOFF', type: 'FIXED_CENTS', valueCents: 1000 },
  ] as const
  for (const discount of discountCodes) {
    await prisma.discountCode.upsert({
      where: { locationId_code: { locationId: provo.id, code: discount.code } },
      create: {
        id: id(),
        locationId: provo.id,
        appliesTo: 'ALL',
        active: true,
        ...discount,
      },
      update: { active: true },
    })
  }

  // --- Staff users & roles ----------------------------------------------------
  // Placeholder phones: staff sign in via phone OTP, and the first verification
  // links StaffUser.authUserId by phone match — a phoneless staff row can never
  // sign in. Replace with real numbers before the pilot.
  const staff = [
    {
      name: 'Provo Owner',
      email: 'owner@provo.plunj.example',
      phone: '+15550100001',
      role: 'LOCATION_OWNER',
    },
    {
      name: 'Provo Front Desk',
      email: 'frontdesk@provo.plunj.example',
      phone: '+15550100002',
      role: 'FRONT_DESK',
    },
  ] as const
  for (const member of staff) {
    const staffUser = await prisma.staffUser.upsert({
      where: { email: member.email },
      create: {
        id: id(),
        name: member.name,
        email: member.email,
        phone: member.phone,
        active: true,
      },
      update: { name: member.name, phone: member.phone, active: true },
    })
    await prisma.staffRole.upsert({
      where: {
        staffUserId_role_locationId: {
          staffUserId: staffUser.id,
          role: member.role,
          locationId: provo.id,
        },
      },
      create: { id: id(), staffUserId: staffUser.id, role: member.role, locationId: provo.id },
      update: {},
    })
  }

  console.log(
    `Seeded: org ${org.name}, location ${provo.slug}, studio ${studio.name}, ` +
      `${templateCount} session templates, ${buyouts.length} buyout options, ` +
      `${waivers.length} waiver documents, ${discountCodes.length} discount codes, ` +
      `${staff.length} staff users`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
