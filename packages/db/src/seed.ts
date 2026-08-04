/**
 * Idempotent seed for local/dev databases: `pnpm --filter @plunj/db db:seed`.
 * Every write is an upsert (or find-or-create where no natural key exists),
 * so re-running always converges to the same state.
 */
import { createHash } from 'node:crypto'
import { id, prisma } from './index.js'
import type { Prisma } from './index.js'
import {
  LIABILITY_WAIVER_MARKDOWN,
  MINOR_CONSENT_MARKDOWN,
  PRIVACY_POLICY_MARKDOWN,
} from './waiver-content.js'
import { MOMENCE_LOCATIONS } from './seed-locations.js'

const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z')

// Real Momence drop-in price for Provo (host 78731), fetched 2026-08-04.
const PROVO_PRICE_CENTS = 3500

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

const WAIVER_DOCS = [
  { kind: 'LIABILITY', title: 'Waiver and Release of Liability', body: LIABILITY_WAIVER_MARKDOWN },
  { kind: 'MINOR_CONSENT', title: 'Parent / Guardian Consent', body: MINOR_CONSENT_MARKDOWN },
  { kind: 'PRIVACY', title: 'Privacy Policy', body: PRIVACY_POLICY_MARKDOWN },
] as const

async function seedWaiverDocs(locationId: string): Promise<void> {
  for (const waiver of WAIVER_DOCS) {
    await prisma.waiverDocument.upsert({
      where: { locationId_kind_version: { locationId, kind: waiver.kind, version: 1 } },
      create: {
        id: id(),
        locationId,
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
}

/**
 * Standard network membership lineup. Prices are Provo's REAL Momence prices
 * (fetched 2026-08-04) applied network-wide as provisional demo data — confirm
 * per location at cutover.
 */
const MEMBERSHIP_PLANS = [
  {
    name: 'LAGOM Pass',
    priceCents: 9653,
    visitPolicy: 'N_PER_PERIOD',
    visitsPerPeriod: 8,
    guestPassesPerPeriod: 0,
  },
  {
    name: 'SISU Unlimited',
    priceCents: 13000,
    visitPolicy: 'UNLIMITED',
    visitsPerPeriod: null,
    guestPassesPerPeriod: 0,
  },
  {
    name: 'Sisu 2.0',
    priceCents: 17696,
    visitPolicy: 'UNLIMITED',
    visitsPerPeriod: null,
    guestPassesPerPeriod: 2,
  },
] as const

const PUNCH_PASS = { name: '10 Visit Punch Pass', credits: 10, priceCents: 26813 } as const

async function seedMembershipListings(locationId: string): Promise<void> {
  for (const plan of MEMBERSHIP_PLANS) {
    // MembershipPlan has no natural unique key — find-or-create by (locationId, name).
    const existing = await prisma.membershipPlan.findFirst({
      where: { locationId, name: plan.name },
    })
    const data = {
      priceCents: plan.priceCents,
      interval: 'MONTH',
      visitPolicy: plan.visitPolicy,
      visitsPerPeriod: plan.visitsPerPeriod,
      guestPassesPerPeriod: plan.guestPassesPerPeriod,
      giftable: true,
      active: true,
    } as const
    if (existing) {
      await prisma.membershipPlan.update({ where: { id: existing.id }, data })
    } else {
      await prisma.membershipPlan.create({
        data: { id: id(), locationId, name: plan.name, ...data },
      })
    }
  }

  // Pack also has no natural unique key — same find-or-create by (locationId, name).
  const existingPack = await prisma.pack.findFirst({
    where: { locationId, name: PUNCH_PASS.name },
  })
  const packData = { credits: PUNCH_PASS.credits, priceCents: PUNCH_PASS.priceCents, active: true }
  if (existingPack) {
    await prisma.pack.update({ where: { id: existingPack.id }, data: packData })
  } else {
    await prisma.pack.create({ data: { id: id(), locationId, name: PUNCH_PASS.name, ...packData } })
  }
}

/**
 * "06:00-22:30" or "06:00-11:30,16:30-20:30" → hourly session start times
 * ("HH:MM") for 60-minute sessions: from each range's open, every 60 minutes,
 * while the session still ends by close. Handles half-hour boundaries.
 */
function startTimesFromHours(value: string | null | undefined): string[] {
  if (!value) return []
  const toMin = (t: string): number => {
    const [h, m] = t.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const starts: string[] = []
  for (const range of value.split(',')) {
    const [open, close] = range.trim().split('-')
    if (!open || !close) continue
    for (let t = toMin(open); t + 60 <= toMin(close); t += 60) {
      starts.push(
        `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
      )
    }
  }
  return starts
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

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
        defaultCapacity: 6, // real Momence capacity (host 78731)
        active: true,
      },
    }))
  await prisma.studio.update({ where: { id: studio.id }, data: { defaultCapacity: 6 } })

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
          priceCents: PROVO_PRICE_CENTS,
          effectiveFrom: EFFECTIVE_FROM,
          active: true,
        },
        update: { priceCents: PROVO_PRICE_CENTS, offeringType: 'COMMUNAL', active: true },
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
  // The "new waiver per location" business rule means every internal location
  // publishes its own copy of the corporate documents.
  await seedWaiverDocs(provo.id)

  // --- Membership plans + punch pass (real Provo Momence prices) --------------
  await seedMembershipListings(provo.id)

  // --- Staff users & roles ----------------------------------------------------
  // Placeholder phones: staff sign in via phone OTP, and the first verification
  // links StaffUser.authUserId by phone match — a phoneless staff row can never
  // sign in. Replace with real numbers before the pilot.
  const staff = [
    {
      name: 'PLUNJ Corporate',
      email: 'corporate@plunj.example',
      phone: '+15550100000',
      role: 'CORPORATE_ADMIN',
      locationId: null,
    },
    {
      name: 'Provo Owner',
      email: 'owner@provo.plunj.example',
      phone: '+15550100001',
      role: 'LOCATION_OWNER',
      locationId: provo.id,
    },
    {
      name: 'Provo Front Desk',
      email: 'frontdesk@provo.plunj.example',
      phone: '+15550100002',
      role: 'FRONT_DESK',
      locationId: provo.id,
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
    // CORPORATE_ADMIN roles carry a NULL locationId, which the composite unique
    // treats as distinct — find-or-create instead of upsert.
    const existingRole = await prisma.staffRole.findFirst({
      where: { staffUserId: staffUser.id, role: member.role, locationId: member.locationId },
    })
    if (!existingRole) {
      await prisma.staffRole.create({
        data: {
          id: id(),
          staffUserId: staffUser.id,
          role: member.role,
          locationId: member.locationId,
        },
      })
    }
  }

  // --- The rest of the network -------------------------------------------------
  // Demo mode: every ACTIVE location books internally. Studios, waiver docs,
  // and session templates are derived from the scraped hours; drop-in price
  // defaults to Provo's confirmed $45 — REAL PER-LOCATION PRICES ARE UNKNOWN
  // (not published on plunj.co) and must be corrected before any real cutover.
  const DEFAULT_PRICE_CENTS = 3500
  for (const loc of MOMENCE_LOCATIONS) {
    const active = loc.status === 'ACTIVE'
    const data = {
      orgId: org.id,
      name: loc.name,
      timezone: loc.timezone,
      address1: loc.address1,
      address2: loc.address2 ?? null,
      city: loc.city,
      state: loc.state,
      postalCode: loc.postalCode,
      phone: loc.phone,
      email: loc.email,
      status: loc.status,
      taxRateBps: loc.taxRateBps,
      bookingProvider: active ? 'INTERNAL' : 'MOMENCE',
      momenceUrl: `https://plunj.co/locations/${loc.slug}#booking`,
      settings: loc.settings as Prisma.InputJsonObject,
    } as const
    const location = await prisma.location.upsert({
      where: { slug: loc.slug },
      create: { id: id(), slug: loc.slug, ...data },
      update: data,
    })
    if (!active) continue

    const locStudio =
      (await prisma.studio.findFirst({
        where: { locationId: location.id, name: 'Contrast Suite' },
      })) ??
      (await prisma.studio.create({
        data: {
          id: id(),
          locationId: location.id,
          name: 'Contrast Suite',
          kind: 'CONTRAST_SUITE',
          defaultCapacity: loc.sessionCapacity ?? 8,
          active: true,
        },
      }))
    await prisma.studio.update({
      where: { id: locStudio.id },
      data: { defaultCapacity: loc.sessionCapacity ?? 8 },
    })

    // Templates from scraped hours; locations with no published hours (Logan)
    // fall back to Provo-style hours so they're bookable in the demo.
    const hours = (loc.settings.hours ?? null) as Record<string, string | null> | null
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      const startTimes = hours
        ? startTimesFromHours(hours[DAY_KEYS[dayOfWeek]!])
        : startHoursForDay(dayOfWeek).map(hourToLocalTime)
      for (const startTimeLocal of startTimes) {
        await prisma.sessionTemplate.upsert({
          where: {
            studioId_dayOfWeek_startTimeLocal_effectiveFrom: {
              studioId: locStudio.id,
              dayOfWeek,
              startTimeLocal,
              effectiveFrom: EFFECTIVE_FROM,
            },
          },
          create: {
            id: id(),
            studioId: locStudio.id,
            locationId: location.id,
            dayOfWeek,
            startTimeLocal,
            durationMin: 60,
            offeringType: 'COMMUNAL',
            priceCents: loc.sessionPriceCents ?? DEFAULT_PRICE_CENTS,
            effectiveFrom: EFFECTIVE_FROM,
            active: true,
          },
          update: { active: true, priceCents: loc.sessionPriceCents ?? DEFAULT_PRICE_CENTS },
        })
      }
    }

    // Buyout tiers from scraped data (numeric tiers only).
    const scrapedBuyouts = (loc.settings.buyouts ?? []) as Array<{
      hours?: number
      priceUsd?: number
      maxGuests?: number
    }>
    const numericTiers = scrapedBuyouts.filter(
      (tier): tier is { hours: number; priceUsd: number; maxGuests?: number } =>
        typeof tier.hours === 'number' && typeof tier.priceUsd === 'number',
    )
    for (const tier of numericTiers) {
      const existing = await prisma.buyoutOption.findFirst({
        where: { locationId: location.id, durationHours: tier.hours },
      })
      const tierData = {
        priceCents: tier.priceUsd * 100,
        maxGuests: tier.maxGuests ?? 10,
        active: true,
      }
      if (existing) {
        await prisma.buyoutOption.update({ where: { id: existing.id }, data: tierData })
      } else {
        await prisma.buyoutOption.create({
          data: {
            id: id(),
            locationId: location.id,
            durationHours: tier.hours,
            ...tierData,
          },
        })
      }
    }

    // Locations with no scraped buyout tiers get a provisional 1-hour default,
    // estimated from the network ratio (Provo's real pricing: $210 = 6 × the
    // $35 drop-in), with room for a couple of guests beyond communal capacity.
    // Owner-editable in admin — confirm real buyout pricing at cutover.
    if (numericTiers.length === 0) {
      const defaultTier = {
        priceCents: 6 * (loc.sessionPriceCents ?? DEFAULT_PRICE_CENTS),
        maxGuests: (loc.sessionCapacity ?? 8) + 2,
        active: true,
      }
      const existing = await prisma.buyoutOption.findFirst({
        where: { locationId: location.id, durationHours: 1 },
      })
      if (existing) {
        await prisma.buyoutOption.update({ where: { id: existing.id }, data: defaultTier })
      } else {
        await prisma.buyoutOption.create({
          data: { id: id(), locationId: location.id, durationHours: 1, ...defaultTier },
        })
      }
    }

    await seedWaiverDocs(location.id)
    await seedMembershipListings(location.id)
  }

  // --- Discount codes for testing (every internal location) -------------------
  const discountCodes = [
    { code: 'WELCOME20', type: 'PERCENT', valueBps: 2000 },
    { code: 'FIRSTTIMER', type: 'PERCENT', valueBps: 5000 },
    { code: 'TENOFF', type: 'FIXED_CENTS', valueCents: 1000 },
  ] as const
  const internalLocations = await prisma.location.findMany({
    where: { status: 'ACTIVE', bookingProvider: 'INTERNAL' },
    select: { id: true },
  })
  for (const { id: locationId } of internalLocations) {
    for (const discount of discountCodes) {
      await prisma.discountCode.upsert({
        where: { locationId_code: { locationId, code: discount.code } },
        create: {
          id: id(),
          locationId,
          appliesTo: 'ALL',
          active: true,
          ...discount,
        },
        update: { active: true },
      })
    }
  }

  console.log(
    `Seeded: org ${org.name}, location ${provo.slug}, studio ${studio.name}, ` +
      `${templateCount} session templates, ${buyouts.length} buyout options, ` +
      `${WAIVER_DOCS.length} waiver documents per internal location, ` +
      `${MEMBERSHIP_PLANS.length} membership plans + 1 pack per internal location, ` +
      `${discountCodes.length} discount codes, ${staff.length} staff users, ` +
      `${MOMENCE_LOCATIONS.length} network locations`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
