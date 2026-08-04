'use client'

/**
 * Team management: list (admin+), invite / role change / deactivate (owner
 * only — a FORBIDDEN from those mutations renders the owner-gate message).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Select } from '@/components/admin/fields'
import { isForbidden, useStaffGuard } from '@/components/admin/staff'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { useTRPC } from '@/lib/trpc/client'

type Role = 'FRONT_DESK' | 'LOCATION_ADMIN' | 'LOCATION_OWNER'

const ROLE_LABELS: Record<string, string> = {
  FRONT_DESK: 'Team Member',
  LOCATION_ADMIN: 'Manager',
  LOCATION_OWNER: 'Owner',
  CORPORATE_ADMIN: 'Corporate',
}

const OWNER_GATE = 'Only the owner can manage the team.'

export function TeamClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('FRONT_DESK')

  const team = useQuery(trpc.admin.team.list.queryOptions({ locationSlug: location.slug }))
  useStaffGuard(team.error)

  const invalidate = () => void queryClient.invalidateQueries(trpc.admin.team.list.pathFilter())

  const onMutationError = (err: unknown) => {
    setError(isForbidden(err) ? OWNER_GATE : ((err as { message?: string }).message ?? 'Failed.'))
  }

  const inviteMutation = useMutation(
    trpc.admin.team.invite.mutationOptions({
      onSuccess: () => {
        setNote(`Invited ${inviteName.trim()}.`)
        setInviteName('')
        setInviteEmail('')
        setInvitePhone('')
        setInviteRole('FRONT_DESK')
        invalidate()
      },
      onError: onMutationError,
    }),
  )
  const setRoleMutation = useMutation(
    trpc.admin.team.setRole.mutationOptions({
      onSuccess: () => {
        setNote('Role updated.')
        invalidate()
      },
      onError: onMutationError,
    }),
  )
  const deactivateMutation = useMutation(
    trpc.admin.team.deactivate.mutationOptions({
      onSuccess: () => {
        setNote('Team member deactivated.')
        invalidate()
      },
      onError: onMutationError,
    }),
  )
  useStaffGuard(inviteMutation.error, setRoleMutation.error, deactivateMutation.error)

  const canInvite = inviteName.trim() !== '' && /.+@.+\..+/.test(inviteEmail.trim())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-gray-500">
          Team Member runs the desk · Manager also edits the schedule · Owner does everything.
        </p>
      </div>

      {note ? <p className="rounded-card bg-ok/5 px-4 py-3 text-sm text-ok">{note}</p> : null}
      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        {team.isPending ? (
          <div className="flex flex-col gap-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (team.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No team members at this location yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(team.data ?? []).map((member) => (
              <li
                key={member.staffUserId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {member.name}
                    <Badge tone={member.active ? 'ok' : 'danger'}>
                      {member.active ? 'active' : 'deactivated'}
                    </Badge>
                  </p>
                  <p className="text-sm text-gray-500">
                    {[member.phone, member.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    onChange={(e) =>
                      setRoleMutation.mutate({
                        locationSlug: location.slug,
                        staffUserId: member.staffUserId,
                        role: e.target.value as Role,
                      })
                    }
                    disabled={setRoleMutation.isPending || member.role === 'CORPORATE_ADMIN'}
                  >
                    {member.role === 'CORPORATE_ADMIN' ? (
                      <option value="CORPORATE_ADMIN">{ROLE_LABELS.CORPORATE_ADMIN}</option>
                    ) : null}
                    <option value="FRONT_DESK">{ROLE_LABELS.FRONT_DESK}</option>
                    <option value="LOCATION_ADMIN">{ROLE_LABELS.LOCATION_ADMIN}</option>
                    <option value="LOCATION_OWNER">{ROLE_LABELS.LOCATION_OWNER}</option>
                  </Select>
                  {member.active ? (
                    <Button
                      variant="danger"
                      onClick={() =>
                        deactivateMutation.mutate({
                          locationSlug: location.slug,
                          staffUserId: member.staffUserId,
                        })
                      }
                      loading={deactivateMutation.isPending}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Invite</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Name"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <Input
            label="Phone (optional)"
            type="tel"
            inputMode="tel"
            value={invitePhone}
            onChange={(e) => setInvitePhone(e.target.value)}
            hint="Staff sign in by phone OTP."
          />
          <Select
            label="Role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
          >
            <option value="FRONT_DESK">{ROLE_LABELS.FRONT_DESK}</option>
            <option value="LOCATION_ADMIN">{ROLE_LABELS.LOCATION_ADMIN}</option>
            <option value="LOCATION_OWNER">{ROLE_LABELS.LOCATION_OWNER}</option>
          </Select>
        </div>
        <div>
          <Button
            onClick={() => {
              setError(null)
              setNote(null)
              const phone = invitePhone.trim()
              inviteMutation.mutate({
                locationSlug: location.slug,
                name: inviteName.trim(),
                email: inviteEmail.trim(),
                ...(phone.length >= 7 ? { phone } : {}),
                role: inviteRole,
              })
            }}
            disabled={!canInvite}
            loading={inviteMutation.isPending}
          >
            Invite
          </Button>
        </div>
      </Card>
    </div>
  )
}
