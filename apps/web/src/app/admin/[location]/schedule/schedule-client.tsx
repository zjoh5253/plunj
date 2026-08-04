'use client'

/**
 * Weekly template grid + session generation + closures.
 *
 * - Grid rows are hours 5:00–22:00, columns Mon–Sun; cells show templates
 *   (time / capacity / price verbatim from the server).
 * - Edits go through admin.schedule.templates.create/update; the ONLY
 *   dollars→cents conversion is form-input encoding.
 * - After an edit, "Apply to future sessions" runs applyChanges and surfaces
 *   returned conflicts (booked/closed future sessions) as a needs-manual-
 *   resolution list.
 * - Closures ALWAYS run dryRun first and show the blast radius ("N confirmed
 *   bookings affected") in a confirm dialog before the real mutation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Select } from '@/components/admin/fields'
import { useStaffGuard } from '@/components/admin/staff'
import type {
  AdminApplyChangesResult,
  AdminClosureResult,
  AdminTemplate,
} from '@/components/admin/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { formatCents, formatTimeOfDay, localDateKey } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

// Mon–Sun columns; SessionTemplate.dayOfWeek is 0 = Sunday … 6 = Saturday.
const DAY_COLUMNS = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5) // 5:00 … 22:00

/** "HH:MM" → "6:00 AM" (pure string formatting — no timezone involved). */
function formatLocalTime(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  const hour = Number(h ?? 0)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${m ?? '00'} ${suffix}`
}

/** Form-input encoding only (invariant #1): "$45" text → 4500 cents. */
function dollarsToCents(text: string): number | null {
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

type EditorState =
  | { mode: 'create'; dayOfWeek: number; startTimeLocal: string }
  | { mode: 'edit'; template: AdminTemplate }
  | null

export function ScheduleClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState>(null)
  const [applyCandidate, setApplyCandidate] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<AdminApplyChangesResult | null>(null)
  const [generateNote, setGenerateNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const templates = useQuery(
    trpc.admin.schedule.templates.list.queryOptions({ locationSlug: location.slug }),
  )
  useStaffGuard(templates.error)

  const invalidateTemplates = () =>
    void queryClient.invalidateQueries(trpc.admin.schedule.templates.list.pathFilter())

  const generateMutation = useMutation(
    trpc.admin.schedule.generate.mutationOptions({
      onSuccess: (result) => {
        setGenerateNote(
          `Regenerated: ${result.created} new session${result.created === 1 ? '' : 's'} created (${result.scanned} scanned).`,
        )
      },
      onError: (err) => setError(err.message),
    }),
  )

  const applyMutation = useMutation(
    trpc.admin.schedule.applyChanges.mutationOptions({
      onSuccess: (result) => {
        setApplyResult(result)
        setApplyCandidate(null)
        invalidateTemplates()
      },
      onError: (err) => setError(err.message),
    }),
  )
  useStaffGuard(generateMutation.error, applyMutation.error)

  const grid = useMemo(() => {
    const map = new Map<string, AdminTemplate[]>()
    for (const t of templates.data ?? []) {
      const hour = Number.parseInt(t.startTimeLocal.slice(0, 2), 10)
      const key = `${t.dayOfWeek}:${hour}`
      const cell = map.get(key) ?? []
      cell.push(t)
      map.set(key, cell)
    }
    return map
  }, [templates.data])

  const offGrid = useMemo(
    () =>
      (templates.data ?? []).filter((t) => {
        const hour = Number.parseInt(t.startTimeLocal.slice(0, 2), 10)
        return hour < 5 || hour > 22
      }),
    [templates.data],
  )

  const studioIds = useMemo(
    () => [...new Set((templates.data ?? []).map((t) => t.studioId))],
    [templates.data],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">
            Weekly recurring templates · times are location-local ({location.timezone})
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setGenerateNote(null)
              generateMutation.mutate({ locationSlug: location.slug })
            }}
            loading={generateMutation.isPending}
          >
            Regenerate sessions
          </Button>
          <Button
            onClick={() => setEditor({ mode: 'create', dayOfWeek: 1, startTimeLocal: '06:00' })}
          >
            New template
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {generateNote ? (
        <p className="rounded-card bg-ok/5 px-4 py-3 text-sm text-ok">{generateNote}</p>
      ) : null}

      {applyCandidate ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warn/40">
          <p className="text-sm text-ink">
            Template saved. Apply the change to future sessions? Untouched empty sessions are
            replaced; booked ones are kept and reported as conflicts.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => applyMutation.mutate({ templateId: applyCandidate })}
              loading={applyMutation.isPending}
            >
              Apply to future sessions
            </Button>
            <Button variant="ghost" onClick={() => setApplyCandidate(null)}>
              Later
            </Button>
          </div>
        </Card>
      ) : null}

      {applyResult ? (
        <Card className={applyResult.conflictSessionIds.length > 0 ? 'border-warn/40' : ''}>
          <p className="text-sm">
            Applied: {applyResult.deleted} future session
            {applyResult.deleted === 1 ? '' : 's'} replaced, {applyResult.created} regenerated.
          </p>
          {applyResult.conflictSessionIds.length > 0 ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-warn">
                Needs manual resolution — {applyResult.conflictSessionIds.length} future session
                {applyResult.conflictSessionIds.length === 1 ? ' has' : 's have'} bookings (or are
                closed) and kept their old time/price:
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-gray-500">
                {applyResult.conflictSessionIds.map((id) => (
                  <li key={id} className="font-mono">
                    {id}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                Close them below (with blast radius) or leave them to run out at the old settings.
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Weekly grid */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="w-14 border-b border-gray-200 pb-2 text-left text-xs font-medium text-gray-400" />
              {DAY_COLUMNS.map((d) => (
                <th
                  key={d}
                  className="border-b border-gray-200 pb-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {DAY_NAMES[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.isPending
              ? HOURS.slice(0, 6).map((h) => (
                  <tr key={h}>
                    <td className="py-1 pr-2 align-top text-xs text-gray-400">{h}:00</td>
                    {DAY_COLUMNS.map((d) => (
                      <td key={d} className="p-0.5">
                        <Skeleton className="h-8" />
                      </td>
                    ))}
                  </tr>
                ))
              : HOURS.map((hour) => (
                  <tr key={hour}>
                    <td className="border-b border-gray-50 py-1 pr-2 align-top text-xs tabular-nums text-gray-400">
                      {formatLocalTime(`${String(hour).padStart(2, '0')}:00`)}
                    </td>
                    {DAY_COLUMNS.map((day) => {
                      const cell = grid.get(`${day}:${hour}`) ?? []
                      return (
                        <td key={day} className="border-b border-gray-50 p-0.5 align-top">
                          <div className="flex min-h-8 flex-col gap-0.5">
                            {cell.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => setEditor({ mode: 'edit', template: t })}
                                className={`rounded-card border px-2 py-1 text-left text-xs transition-colors ${
                                  t.active
                                    ? 'border-gray-200 bg-white hover:border-gray-400'
                                    : 'border-gray-100 bg-gray-50 text-gray-400'
                                }`}
                              >
                                <span className="font-medium">
                                  {formatLocalTime(t.startTimeLocal)}
                                </span>
                                <span className="block text-gray-500">
                                  {t.capacity !== null ? `${t.capacity} seats` : 'studio default'} ·{' '}
                                  {formatCents(t.priceCents)}
                                </span>
                                {!t.active ? <span className="block">inactive</span> : null}
                              </button>
                            ))}
                            <button
                              type="button"
                              aria-label={`Add template ${DAY_NAMES[day]} ${hour}:00`}
                              onClick={() =>
                                setEditor({
                                  mode: 'create',
                                  dayOfWeek: day,
                                  startTimeLocal: `${String(hour).padStart(2, '0')}:00`,
                                })
                              }
                              className="rounded-card px-2 py-0.5 text-left text-xs text-transparent transition-colors hover:bg-gray-50 hover:text-gray-400"
                            >
                              +
                            </button>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {offGrid.length > 0 ? (
        <Card>
          <p className="text-sm font-medium">Outside the 5:00–22:00 grid</p>
          <ul className="mt-1 flex flex-col gap-1">
            {offGrid.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setEditor({ mode: 'edit', template: t })}
                >
                  {DAY_NAMES[t.dayOfWeek]} {formatLocalTime(t.startTimeLocal)} ·{' '}
                  {formatCents(t.priceCents)}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ClosuresSection location={location} />

      {editor ? (
        <TemplateEditor
          location={location}
          editor={editor}
          studioIds={studioIds}
          onClose={() => setEditor(null)}
          onSaved={(templateId) => {
            setEditor(null)
            setApplyResult(null)
            setApplyCandidate(templateId)
            invalidateTemplates()
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template create/edit sheet
// ---------------------------------------------------------------------------

function TemplateEditor({
  location,
  editor,
  studioIds,
  onClose,
  onSaved,
}: {
  location: LocationDetail
  editor: NonNullable<EditorState>
  studioIds: string[]
  onClose: () => void
  onSaved: (templateId: string) => void
}) {
  const trpc = useTRPC()
  const existing = editor.mode === 'edit' ? editor.template : null

  const todayKey = localDateKey(new Date(), location.timezone)
  const [studioId, setStudioId] = useState(existing?.studioId ?? studioIds[0] ?? '')
  const [dayOfWeek, setDayOfWeek] = useState(
    existing?.dayOfWeek ?? (editor.mode === 'create' ? editor.dayOfWeek : 1),
  )
  const [startTime, setStartTime] = useState(
    existing?.startTimeLocal ?? (editor.mode === 'create' ? editor.startTimeLocal : '06:00'),
  )
  const [duration, setDuration] = useState(String(existing?.durationMin ?? 60))
  const [capacity, setCapacity] = useState(
    existing?.capacity !== null && existing ? String(existing.capacity) : '',
  )
  const [offeringType, setOfferingType] = useState<'COMMUNAL' | 'PRIVATE_ONLY' | 'BOTH'>(
    (existing?.offeringType as 'COMMUNAL' | 'PRIVATE_ONLY' | 'BOTH' | undefined) ?? 'COMMUNAL',
  )
  // Dollars in the input; cents on the wire (encoding only — invariant #1).
  const [priceDollars, setPriceDollars] = useState(
    existing ? (existing.priceCents / 100).toFixed(2) : '',
  )
  const [effectiveFrom, setEffectiveFrom] = useState(existing?.effectiveFrom ?? todayKey)
  const [effectiveUntil, setEffectiveUntil] = useState(existing?.effectiveUntil ?? '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation(
    trpc.admin.schedule.templates.create.mutationOptions({
      onSuccess: (r) => onSaved(r.templateId),
      onError: (err) => setError(err.message),
    }),
  )
  const updateMutation = useMutation(
    trpc.admin.schedule.templates.update.mutationOptions({
      onSuccess: (r) => onSaved(r.templateId),
      onError: (err) => setError(err.message),
    }),
  )
  useStaffGuard(createMutation.error, updateMutation.error)

  const priceCents = dollarsToCents(priceDollars)
  const durationMin = Number.parseInt(duration, 10)
  const capacityValue = capacity.trim() === '' ? null : Number.parseInt(capacity, 10)
  const valid =
    priceCents !== null &&
    Number.isFinite(durationMin) &&
    durationMin >= 15 &&
    (editor.mode === 'edit' || studioId.trim() !== '') &&
    /^\d{2}:\d{2}$/.test(startTime) &&
    (capacityValue === null || capacityValue >= 1)

  const submit = () => {
    if (!valid || priceCents === null) return
    setError(null)
    if (existing) {
      updateMutation.mutate({
        templateId: existing.id,
        startTimeLocal: startTime,
        durationMin,
        capacity: capacityValue,
        priceCents,
        effectiveUntil: effectiveUntil === '' ? null : effectiveUntil,
        active,
      })
    } else {
      createMutation.mutate({
        locationSlug: location.slug,
        studioId,
        dayOfWeek,
        startTimeLocal: startTime,
        durationMin,
        capacity: capacityValue,
        offeringType,
        priceCents,
        effectiveFrom,
        effectiveUntil: effectiveUntil === '' ? null : effectiveUntil,
      })
    }
  }

  return (
    <Dialog open onClose={onClose} title={existing ? 'Edit template' : 'New template'}>
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
        {!existing ? (
          studioIds.length > 0 ? (
            <Select label="Studio" value={studioId} onChange={(e) => setStudioId(e.target.value)}>
              {studioIds.map((id) => (
                <option key={id} value={id}>
                  Studio {id.slice(0, 8)}…
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Studio ID"
              value={studioId}
              onChange={(e) => setStudioId(e.target.value)}
              hint="No templates exist yet to infer studios from — paste the studio id. (No studios-list API yet.)"
            />
          )
        ) : null}
        {!existing ? (
          <Select
            label="Day of week"
            value={String(dayOfWeek)}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
          >
            {DAY_COLUMNS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start time (local)"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            label="Duration (min)"
            type="number"
            min={15}
            max={480}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Studio default"
            hint="Blank = studio default"
          />
          <Input
            label="Price ($)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
          />
        </div>
        {!existing ? (
          <Select
            label="Offering type"
            value={offeringType}
            onChange={(e) =>
              setOfferingType(e.target.value as 'COMMUNAL' | 'PRIVATE_ONLY' | 'BOTH')
            }
          >
            <option value="COMMUNAL">Communal</option>
            <option value="PRIVATE_ONLY">Private only</option>
            <option value="BOTH">Both</option>
          </Select>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {!existing ? (
            <Input
              label="Effective from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          ) : null}
          <Input
            label="Effective until"
            type="date"
            value={effectiveUntil}
            onChange={(e) => setEffectiveUntil(e.target.value)}
            hint="Blank = open-ended"
          />
        </div>
        {existing ? (
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-ink"
            />
            Active (uncheck to retire this template — there is no delete API)
          </label>
        ) : null}
        {error ? (
          <p className="rounded-card bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-1 flex gap-2">
          <Button
            onClick={submit}
            disabled={!valid}
            loading={createMutation.isPending || updateMutation.isPending}
          >
            {existing ? 'Save changes' : 'Create template'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Closures — dryRun-first blast radius, always
// ---------------------------------------------------------------------------

function ClosuresSection({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [date, setDate] = useState(() => localDateKey(new Date(), location.timezone))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<{ sessionIds: string[]; dry: AdminClosureResult } | null>(
    null,
  )
  const [recentlyClosed, setRecentlyClosed] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const day = useQuery(
    trpc.public.availability.list.queryOptions(
      { locationSlug: location.slug, fromDate: date, toDate: date },
      { enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) },
    ),
  )
  const sessions = day.data?.[0]?.sessions ?? []

  const closureMutation = useMutation(
    trpc.admin.schedule.closures.mutationOptions({
      onError: (err) => setError(err.message),
    }),
  )
  useStaffGuard(closureMutation.error)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startClose = () => {
    const sessionIds = [...selected]
    if (sessionIds.length === 0) return
    setError(null)
    setNote(null)
    // ALWAYS dry-run first: the confirm dialog shows the blast radius.
    closureMutation.mutate(
      { sessionIds, action: 'CLOSE', dryRun: true },
      { onSuccess: (dry) => setPending({ sessionIds, dry }) },
    )
  }

  const confirmClose = () => {
    if (!pending) return
    closureMutation.mutate(
      { sessionIds: pending.sessionIds, action: 'CLOSE', dryRun: false },
      {
        onSuccess: (result) => {
          setRecentlyClosed((prev) => [...new Set([...prev, ...pending.sessionIds])])
          setNote(
            `Closed ${result.updated} session${result.updated === 1 ? '' : 's'} — ${result.affected.length} booking${result.affected.length === 1 ? '' : 's'} affected.`,
          )
          setPending(null)
          setSelected(new Set())
          void queryClient.invalidateQueries(trpc.public.availability.list.pathFilter())
        },
      },
    )
  }

  const reopen = () => {
    if (recentlyClosed.length === 0) return
    closureMutation.mutate(
      { sessionIds: recentlyClosed, action: 'REOPEN', dryRun: false },
      {
        onSuccess: (result) => {
          setNote(`Reopened ${result.updated} session${result.updated === 1 ? '' : 's'}.`)
          setRecentlyClosed([])
          void queryClient.invalidateQueries(trpc.public.availability.list.pathFilter())
        },
      },
    )
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Closures</h2>
          <p className="text-sm text-gray-500">
            Close individual sessions (holiday, maintenance). You&apos;ll see how many confirmed
            bookings are affected before anything happens.
          </p>
        </div>
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value)
            setSelected(new Set())
          }}
        />
      </div>

      {day.isPending ? (
        <Skeleton className="h-16" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500">
          No open sessions on this date. (Closed sessions are not listable — the availability API
          returns OPEN sessions only. Sessions closed in this sitting can be reopened below.)
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100">
          {sessions.map((s) => (
            <li key={s.sessionId} className="flex items-center justify-between gap-3 py-2">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(s.sessionId)}
                  onChange={() => toggle(s.sessionId)}
                  className="size-4 accent-ink"
                />
                <span className="font-medium tabular-nums">
                  {formatTimeOfDay(s.startsAt, location.timezone)}
                </span>
                <span className="text-gray-500">
                  {s.remainingSeats} of {s.capacity} seats open · {formatCents(s.priceCents)}
                </span>
              </label>
              {s.remainingSeats < s.capacity ? <Badge tone="warn">has bookings</Badge> : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          onClick={startClose}
          disabled={selected.size === 0}
          loading={closureMutation.isPending && pending === null}
        >
          Close {selected.size > 0 ? `${selected.size} selected` : 'selected'}…
        </Button>
        {recentlyClosed.length > 0 ? (
          <Button variant="secondary" onClick={reopen} loading={closureMutation.isPending}>
            Reopen {recentlyClosed.length} just-closed
          </Button>
        ) : null}
      </div>

      {note ? <p className="text-sm text-ok">{note}</p> : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {pending ? (
        <Dialog open onClose={() => setPending(null)} title="Confirm closure">
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Close {pending.sessionIds.length} session
              {pending.sessionIds.length === 1 ? '' : 's'} on {date}?
            </p>
            <p
              className={`rounded-card px-3 py-2 text-sm font-medium ${
                pending.dry.affected.length > 0 ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'
              }`}
            >
              {pending.dry.affected.length} confirmed booking
              {pending.dry.affected.length === 1 ? '' : 's'} affected
            </p>
            {pending.dry.affected.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto text-sm text-gray-600">
                {pending.dry.affected.map((b) => (
                  <li key={b.bookingId} className="flex justify-between gap-2 py-0.5">
                    <span>
                      {b.customerName || b.customerPhone} · {b.seats} seat
                      {b.seats === 1 ? '' : 's'}
                    </span>
                    <span className="text-gray-400">{b.status}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {pending.dry.affected.length > 0 ? (
              <p className="text-xs text-gray-500">
                Closing does not cancel or notify these bookings automatically — reach out and
                resolve them from the desk.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button variant="danger" onClick={confirmClose} loading={closureMutation.isPending}>
                Close sessions
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Card>
  )
}
