'use client'

/**
 * Discount codes — the institutional answer to the Momence wound.
 *
 * Left: code list + create/edit form. Right: LIVE PREVIEW rendered from
 * admin.discounts.preview against the CURRENT FORM STATE (draft mode), using
 * a real drop-in session from this location's schedule, displayed with the
 * same breakdown component shape as customer checkout (invariant #1: preview
 * and checkout render the same server quote).
 *
 * THE RULE: Save stays disabled until the preview has rendered the exact
 * current draft. Rejections render the server's structured message verbatim.
 *
 * The only dollars→cents (and %→bps) conversion here is form-input encoding.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Select } from '@/components/admin/fields'
import { QuoteBreakdown } from '@/components/admin/quote-breakdown'
import { useStaffGuard } from '@/components/admin/staff'
import type { AdminDiscount, AdminQuotePreview, DiscountDraftInput } from '@/components/admin/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Stepper } from '@/components/ui/stepper'
import type { LocationDetail } from '@/lib/api-types'
import { formatCents, formatSessionMoment, localDateKey, upcomingDateKeys } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

type AppliesTo = 'ALL' | 'DROP_IN' | 'BUYOUT' | 'MEMBERSHIP_FIRST_CYCLE' | 'PACK'

const SCOPE_LABELS: Record<AppliesTo, string> = {
  ALL: 'Everything',
  DROP_IN: 'Drop-in sessions',
  BUYOUT: 'Private buyouts',
  MEMBERSHIP_FIRST_CYCLE: 'New memberships',
  PACK: 'Session packs',
}

interface CodeForm {
  code: string
  type: 'PERCENT' | 'FIXED_CENTS'
  /** Percent as typed, e.g. "20" → 2000 bps (input encoding only). */
  percentText: string
  /** Dollars as typed, e.g. "5" → 500 cents (input encoding only). */
  amountText: string
  appliesTo: AppliesTo
  maxRedemptionsText: string
  maxPerCustomerText: string
  /** Dollars as typed. */
  minSubtotalText: string
  startsAtLocal: string
  endsAtLocal: string
  active: boolean
}

const EMPTY_FORM: CodeForm = {
  code: '',
  type: 'PERCENT',
  percentText: '',
  amountText: '',
  appliesTo: 'ALL',
  maxRedemptionsText: '',
  maxPerCustomerText: '',
  minSubtotalText: '',
  startsAtLocal: '',
  endsAtLocal: '',
  active: true,
}

function dollarsToCents(text: string): number | null {
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

function positiveInt(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) && value >= 1 ? value : undefined
}

function isoFromLocal(text: string): string | undefined {
  if (text.trim() === '') return undefined
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function localFromIso(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Current form → draft preview input, or null while the form is incomplete. */
function buildDraft(form: CodeForm): DiscountDraftInput | null {
  const code = form.code.trim()
  if (code === '') return null
  let valueBps: number | undefined
  let valueCents: number | undefined
  if (form.type === 'PERCENT') {
    const percent = Number.parseFloat(form.percentText)
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null
    valueBps = Math.round(percent * 100)
  } else {
    const cents = dollarsToCents(form.amountText)
    if (cents === null || cents < 1) return null
    valueCents = cents
  }
  const minSubtotalCents =
    form.minSubtotalText.trim() === ''
      ? undefined
      : (dollarsToCents(form.minSubtotalText) ?? undefined)
  const startsAt = isoFromLocal(form.startsAtLocal)
  const endsAt = isoFromLocal(form.endsAtLocal)
  const maxRedemptions = positiveInt(form.maxRedemptionsText)
  const maxPerCustomer = positiveInt(form.maxPerCustomerText)
  return {
    code,
    type: form.type,
    ...(valueBps !== undefined ? { valueBps } : {}),
    ...(valueCents !== undefined ? { valueCents } : {}),
    appliesTo: form.appliesTo,
    ...(maxRedemptions !== undefined ? { maxRedemptions } : {}),
    ...(maxPerCustomer !== undefined ? { maxPerCustomer } : {}),
    ...(minSubtotalCents !== undefined ? { minSubtotalCents } : {}),
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
    active: form.active,
  }
}

function formFromRow(row: AdminDiscount): CodeForm {
  return {
    code: row.code,
    type: row.type,
    percentText: row.valueBps !== null ? String(row.valueBps / 100) : '',
    amountText: row.valueCents !== null ? (row.valueCents / 100).toFixed(2) : '',
    appliesTo: row.appliesTo,
    maxRedemptionsText: row.maxRedemptions !== null ? String(row.maxRedemptions) : '',
    maxPerCustomerText: row.maxPerCustomer !== null ? String(row.maxPerCustomer) : '',
    minSubtotalText: row.minSubtotalCents !== null ? (row.minSubtotalCents / 100).toFixed(2) : '',
    startsAtLocal: localFromIso(row.startsAt),
    endsAtLocal: localFromIso(row.endsAt),
    active: row.active,
  }
}

/** "20% off" / "$5.00 off" from the stored definition (definition display, not money math). */
function valueLabel(row: AdminDiscount): string {
  if (row.type === 'PERCENT' && row.valueBps !== null) return `${row.valueBps / 100}% off`
  if (row.valueCents !== null) return `${formatCents(row.valueCents)} off`
  return '—'
}

export function PricingClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CodeForm>(EMPTY_FORM)
  const [guests, setGuests] = useState(2)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CodeForm>(key: K, value: CodeForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const codes = useQuery(trpc.admin.discounts.list.queryOptions({ locationSlug: location.slug }))
  useStaffGuard(codes.error)

  const editingRow = useMemo(
    () => (editingId ? ((codes.data ?? []).find((c) => c.id === editingId) ?? null) : null),
    [codes.data, editingId],
  )
  const editingBrandWide = editingRow !== null && editingRow.locationId === null

  // ------------------------------------------------------------------
  // Sample cart: a real drop-in session from this location's schedule.
  // ------------------------------------------------------------------
  const dateKeys = useMemo(() => upcomingDateKeys(location.timezone, 14), [location.timezone])
  const fromDate = dateKeys[0] ?? localDateKey(new Date(), location.timezone)
  const toDate = dateKeys[dateKeys.length - 1] ?? fromDate
  const availability = useQuery(
    trpc.public.availability.list.queryOptions({ locationSlug: location.slug, fromDate, toDate }),
  )
  const sampleSession = useMemo(() => {
    for (const day of availability.data ?? []) {
      const s = day.sessions[0]
      if (s) return s
    }
    return null
  }, [availability.data])
  const sampleItems = sampleSession
    ? [{ kind: 'DROP_IN' as const, sessionId: sampleSession.sessionId, seats: guests }]
    : null

  // ------------------------------------------------------------------
  // Live preview against the CURRENT FORM STATE (draft mode), debounced.
  // Save is disabled until the preview reflects the current draft exactly.
  // ------------------------------------------------------------------
  const draft = useMemo(() => buildDraft(form), [form])
  const draftKey = JSON.stringify(draft)
  const [debouncedDraft, setDebouncedDraft] = useState<DiscountDraftInput | null>(draft)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDraft(buildDraft(form)), 400)
    return () => clearTimeout(timer)
  }, [form])
  const debouncedKey = JSON.stringify(debouncedDraft)

  const preview = useQuery(
    trpc.admin.discounts.preview.queryOptions(
      {
        locationSlug: location.slug,
        sampleItems: sampleItems ?? [],
        ...(debouncedDraft !== null ? { draft: debouncedDraft } : {}),
      },
      {
        enabled: sampleItems !== null && debouncedDraft !== null,
        placeholderData: keepPreviousData,
      },
    ),
  )
  // Base quote (no code) so a rejected draft still shows the real totals —
  // identical to how customer checkout behaves.
  const baseQuote = useQuery(
    trpc.public.checkout.quote.queryOptions(
      { locationSlug: location.slug, items: sampleItems ?? [] },
      { enabled: sampleItems !== null, placeholderData: keepPreviousData },
    ),
  )
  useStaffGuard(preview.error)

  const previewFresh =
    draft !== null &&
    debouncedKey === draftKey &&
    preview.data !== undefined &&
    !preview.isFetching &&
    sampleItems !== null

  const previewData: AdminQuotePreview | undefined = preview.data
  const previewOk = previewData !== undefined && previewData.ok ? previewData : null
  const previewRejection =
    previewData !== undefined && previewData.ok === false ? previewData : null

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------
  const invalidate = () =>
    void queryClient.invalidateQueries(trpc.admin.discounts.list.pathFilter())

  const createMutation = useMutation(
    trpc.admin.discounts.create.mutationOptions({
      onSuccess: () => {
        setNote(`Saved ${form.code.trim().toUpperCase()}.`)
        setForm(EMPTY_FORM)
        setEditingId(null)
        invalidate()
      },
      onError: (err) => setError(err.message),
    }),
  )
  const updateMutation = useMutation(
    trpc.admin.discounts.update.mutationOptions({
      onSuccess: () => {
        setNote('Code updated.')
        invalidate()
      },
      onError: (err) => setError(err.message),
    }),
  )
  useStaffGuard(createMutation.error, updateMutation.error)

  const save = () => {
    if (!previewFresh || draft === null) return
    setError(null)
    setNote(null)
    if (editingRow) {
      // Stored codes: only limits/window/active are updatable via the API.
      updateMutation.mutate({
        discountCodeId: editingRow.id,
        active: form.active,
        maxRedemptions: positiveInt(form.maxRedemptionsText) ?? null,
        maxPerCustomer: positiveInt(form.maxPerCustomerText) ?? null,
        minSubtotalCents:
          form.minSubtotalText.trim() === ''
            ? null
            : (dollarsToCents(form.minSubtotalText) ?? null),
        startsAt: isoFromLocal(form.startsAtLocal) ?? null,
        endsAt: isoFromLocal(form.endsAtLocal) ?? null,
      })
    } else {
      createMutation.mutate({ locationSlug: location.slug, ...draft })
    }
  }

  const toggleActive = (row: AdminDiscount) => {
    setError(null)
    updateMutation.mutate({ discountCodeId: row.id, active: !row.active })
  }

  const buyouts = useQuery(
    trpc.public.buyouts.options.queryOptions({ locationSlug: location.slug }),
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pricing &amp; Codes</h1>
        <p className="mt-1 text-sm text-gray-500">
          A code cannot be saved until you&apos;ve seen exactly what a customer would see.
        </p>
      </div>

      {note ? <p className="rounded-card bg-ok/5 px-4 py-3 text-sm text-ok">{note}</p> : null}
      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------ Left: list + form */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-1 p-0">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Codes</h2>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingId(null)
                  setForm(EMPTY_FORM)
                }}
              >
                New code
              </Button>
            </div>
            {codes.isPending ? (
              <div className="flex flex-col gap-2 px-5 pb-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (codes.data ?? []).length === 0 ? (
              <p className="px-5 pb-4 text-sm text-gray-500">No discount codes yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(codes.data ?? []).map((row) => (
                  <li key={row.id}>
                    <div
                      className={`flex items-center justify-between gap-3 px-5 py-2.5 ${
                        editingId === row.id ? 'bg-gray-50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 flex-col items-start text-left"
                        onClick={() => {
                          setEditingId(row.id)
                          setForm(formFromRow(row))
                          setNote(null)
                          setError(null)
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{row.code}</span>
                          {row.locationId === null ? <Badge>Brand-wide</Badge> : null}
                          {!row.active ? <Badge tone="danger">inactive</Badge> : null}
                        </span>
                        <span className="text-xs text-gray-500">
                          {valueLabel(row)} · {SCOPE_LABELS[row.appliesTo]}
                          {row.maxRedemptions !== null ? ` · limit ${row.maxRedemptions}` : ''}
                          {row.minSubtotalCents !== null
                            ? ` · min ${formatCents(row.minSubtotalCents)}`
                            : ''}
                          {row.endsAt
                            ? ` · until ${formatSessionMoment(row.endsAt, location.timezone)}`
                            : ''}
                        </span>
                      </button>
                      {row.locationId !== null ? (
                        <Button
                          variant={row.active ? 'secondary' : 'primary'}
                          onClick={() => toggleActive(row)}
                          disabled={updateMutation.isPending}
                        >
                          {row.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
              {editingRow ? `Edit ${editingRow.code}` : 'Create code'}
            </h2>
            {editingBrandWide ? (
              <p className="rounded-card bg-warn/10 px-3 py-2 text-sm text-warn">
                Brand-wide codes are managed by corporate — shown here read-only.
              </p>
            ) : null}
            {editingRow && !editingBrandWide ? (
              <p className="text-xs text-gray-500">
                Code, type, value, and scope are fixed once created (no API to change them) —
                limits, window, and active state are editable.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Code"
                value={form.code}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                disabled={editingRow !== null}
              />
              <Select
                label="Type"
                value={form.type}
                onChange={(e) => set('type', e.target.value as CodeForm['type'])}
                disabled={editingRow !== null}
              >
                <option value="PERCENT">Percent off</option>
                <option value="FIXED_CENTS">Dollar amount off</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {form.type === 'PERCENT' ? (
                <Input
                  label="Percent off (%)"
                  type="number"
                  min={0.01}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  value={form.percentText}
                  onChange={(e) => set('percentText', e.target.value)}
                  disabled={editingRow !== null}
                />
              ) : (
                <Input
                  label="Amount off ($)"
                  type="number"
                  min={0.01}
                  step="0.01"
                  inputMode="decimal"
                  value={form.amountText}
                  onChange={(e) => set('amountText', e.target.value)}
                  disabled={editingRow !== null}
                />
              )}
              <Select
                label="Applies to"
                value={form.appliesTo}
                onChange={(e) => set('appliesTo', e.target.value as AppliesTo)}
                disabled={editingRow !== null}
              >
                {(Object.keys(SCOPE_LABELS) as AppliesTo[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Max redemptions"
                type="number"
                min={1}
                value={form.maxRedemptionsText}
                onChange={(e) => set('maxRedemptionsText', e.target.value)}
                placeholder="∞"
                disabled={editingBrandWide}
              />
              <Input
                label="Per customer"
                type="number"
                min={1}
                value={form.maxPerCustomerText}
                onChange={(e) => set('maxPerCustomerText', e.target.value)}
                placeholder="∞"
                disabled={editingBrandWide}
              />
              <Input
                label="Min subtotal ($)"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.minSubtotalText}
                onChange={(e) => set('minSubtotalText', e.target.value)}
                placeholder="None"
                disabled={editingBrandWide}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Starts"
                type="datetime-local"
                value={form.startsAtLocal}
                onChange={(e) => set('startsAtLocal', e.target.value)}
                disabled={editingBrandWide}
              />
              <Input
                label="Ends"
                type="datetime-local"
                value={form.endsAtLocal}
                onChange={(e) => set('endsAtLocal', e.target.value)}
                disabled={editingBrandWide}
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
                className="size-4 accent-ink"
                disabled={editingBrandWide}
              />
              Active
            </label>
            <div className="flex items-center gap-3">
              <Button
                onClick={save}
                disabled={!previewFresh || editingBrandWide}
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {editingRow ? 'Save changes' : 'Save code'}
              </Button>
              {!previewFresh && draft !== null && sampleItems !== null ? (
                <span className="text-xs text-gray-500">Waiting for the preview…</span>
              ) : null}
              {draft === null ? (
                <span className="text-xs text-gray-500">
                  Enter a code and a value to see the preview.
                </span>
              ) : null}
              {sampleItems === null && !availability.isPending ? (
                <span className="text-xs text-warn">
                  Preview needs a real bookable session — generate sessions on the Schedule screen
                  first. Codes can&apos;t be saved without a preview.
                </span>
              ) : null}
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
              Buyout pricing
            </h2>
            {buyouts.isPending ? (
              <Skeleton className="h-8" />
            ) : (buyouts.data ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No buyout options configured.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {(buyouts.data ?? []).map((o) => (
                  <li key={o.id} className="flex justify-between">
                    <span>
                      {o.durationHours}h private buyout · up to {o.maxGuests} guests
                    </span>
                    <span className="tabular-nums">{formatCents(o.priceCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500">
              Read-only — the admin API doesn&apos;t expose buyout pricing edits yet.
            </p>
          </Card>
        </div>

        {/* ------------------------------ Right: live preview */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          <Card className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
              Live preview
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink">A customer booking</span>
              <Stepper value={guests} min={1} max={10} onChange={setGuests} />
              <span className="text-sm text-ink">guest{guests === 1 ? '' : 's'} would see:</span>
            </div>
            {sampleSession ? (
              <p className="text-xs text-gray-500">
                Sample: {formatSessionMoment(sampleSession.startsAt, location.timezone)} ·{' '}
                {formatCents(sampleSession.priceCents)}/seat (a real session from your schedule)
              </p>
            ) : availability.isPending ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <p className="text-xs text-warn">No upcoming sessions to preview against.</p>
            )}
          </Card>

          {draft === null ? (
            <Card>
              <p className="text-sm text-gray-500">
                Fill in a code and a value on the left — the exact customer breakdown will render
                here.
              </p>
            </Card>
          ) : (
            <QuoteBreakdown
              quote={
                previewOk ? previewOk.quote : baseQuote.data?.ok ? baseQuote.data.quote : undefined
              }
              requoting={preview.isFetching || debouncedKey !== draftKey}
              codeRejection={previewRejection ? previewRejection.message : null}
            />
          )}

          {previewRejection ? (
            <p className="text-xs text-gray-500">
              Rejection reason <span className="font-mono">{previewRejection.reason}</span> — this
              is exactly what checkout would tell the customer. You can still save the code (it may
              be scheduled for later or scoped to a different cart).
            </p>
          ) : null}
          {previewOk && previewOk.discountDescription ? (
            <p className="text-xs text-gray-500">
              Discount line reads: “{previewOk.discountDescription}”
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
