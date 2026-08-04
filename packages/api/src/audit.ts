/**
 * AuditLog writer (CLAUDE.md invariant #7): anything touching money or
 * capacity writes an AuditLog row in the SAME transaction. Always call this
 * with the transaction client of the mutation being audited.
 */

import { id } from '@plunj/db'
import type { ActorType, Prisma, PrismaClient } from '@plunj/db'

export type AuditDbClient = PrismaClient | Prisma.TransactionClient

export interface AuditInput {
  actorType: ActorType
  actorId?: string | null
  locationId?: string | null
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  ip?: string | null
}

export async function audit(tx: AuditDbClient, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      id: id(),
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      locationId: input.locationId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.before !== undefined ? { before: input.before as Prisma.InputJsonValue } : {}),
      ...(input.after !== undefined ? { after: input.after as Prisma.InputJsonValue } : {}),
      ip: input.ip ?? null,
    },
  })
}
