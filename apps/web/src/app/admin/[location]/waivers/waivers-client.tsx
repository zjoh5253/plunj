'use client'

/**
 * Waiver documents: current liability doc (rendered with the same minimal
 * markdown renderer the public waiver page uses) + "Publish new version"
 * editor. Publishing ALWAYS dry-runs first and shows the re-sign consequence
 * ("N customers will be asked to re-sign on their next visit") in a confirm
 * dialog before the real mutation.
 *
 * API gaps (no admin list/history queries yet): only the current LIABILITY
 * document is queryable (public.waivers.current); MINOR_CONSENT / PRIVACY
 * current docs and full version history are not listable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Select, Textarea } from '@/components/admin/fields'
import { useStaffGuard } from '@/components/admin/staff'
import type { AdminWaiverPublishResult } from '@/components/admin/types'
import { Markdown } from '@/components/booking/markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { useTRPC } from '@/lib/trpc/client'

type WaiverKind = 'LIABILITY' | 'MINOR_CONSENT' | 'PRIVACY'

const KIND_LABELS: Record<WaiverKind, string> = {
  LIABILITY: 'Liability waiver',
  MINOR_CONSENT: 'Minor consent',
  PRIVACY: 'Privacy policy',
}

export function WaiversClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [kind, setKind] = useState<WaiverKind>('LIABILITY')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const [dryRunResult, setDryRunResult] = useState<AdminWaiverPublishResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const current = useQuery(
    trpc.public.waivers.current.queryOptions({ locationSlug: location.slug }),
  )

  const publishMutation = useMutation(
    trpc.admin.waivers.publish.mutationOptions({
      onError: (err) => {
        setDryRunResult(null)
        setError(err.message)
      },
    }),
  )
  useStaffGuard(publishMutation.error)

  const canPublish = title.trim() !== '' && body.trim() !== ''

  const startPublish = () => {
    if (!canPublish) return
    setError(null)
    setNote(null)
    // ALWAYS dry-run first — the confirm dialog carries the consequence line.
    publishMutation.mutate(
      {
        locationId: location.id,
        kind,
        title: title.trim(),
        bodyMarkdown: body,
        dryRun: true,
      },
      { onSuccess: (result) => setDryRunResult(result) },
    )
  }

  const confirmPublish = () => {
    publishMutation.mutate(
      {
        locationId: location.id,
        kind,
        title: title.trim(),
        bodyMarkdown: body,
        dryRun: false,
      },
      {
        onSuccess: (result) => {
          setDryRunResult(null)
          setNote(`Published ${KIND_LABELS[kind]} v${result.nextVersion}.`)
          setTitle('')
          setBody('')
          void queryClient.invalidateQueries(trpc.public.waivers.current.pathFilter())
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waivers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Publishing a new version prospectively invalidates old signatures — customers re-sign at
          their next visit; check-in blocks until they do.
        </p>
      </div>

      {note ? <p className="rounded-card bg-ok/5 px-4 py-3 text-sm text-ok">{note}</p> : null}
      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {/* Current documents */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Current documents
        </h2>
        {current.isPending ? (
          <Skeleton className="h-16" />
        ) : current.data ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <Badge tone="ok">v{current.data.version}</Badge>
              <span className="font-medium">{current.data.title}</span>
              <span className="text-sm text-gray-500">
                {KIND_LABELS[current.data.kind as WaiverKind] ?? current.data.kind}
              </span>
              <span className="ml-auto text-sm text-gray-400 group-open:hidden">Show</span>
              <span className="ml-auto hidden text-sm text-gray-400 group-open:inline">Hide</span>
            </summary>
            <div className="mt-3 max-h-96 overflow-y-auto rounded-card border border-gray-100 bg-gray-50 p-4">
              <Markdown source={current.data.bodyMarkdown} />
            </div>
          </details>
        ) : (
          <p className="text-sm text-warn">
            No liability waiver is published — bookings work, but there is nothing for customers to
            sign and check-in has nothing to enforce.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Only the current liability document is queryable — the API has no admin waiver list yet,
          so minor-consent / privacy docs and full version history can&apos;t be shown here.
        </p>
      </Card>

      {/* Publish new version */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Publish new version
          </h2>
          <Button variant="ghost" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Document"
            value={kind}
            onChange={(e) => setKind(e.target.value as WaiverKind)}
          >
            {(Object.keys(KIND_LABELS) as WaiverKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PLUNJ Liability Waiver"
          />
        </div>
        <div className={`grid gap-3 ${showPreview ? 'lg:grid-cols-2' : ''}`}>
          <Textarea
            label="Body (markdown)"
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'# Assumption of risk\n\nBy signing below…'}
            hint="Headings (#, ##, ###), lists (- item), and **bold** — same renderer customers see."
            className="font-mono text-sm"
          />
          {showPreview ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-gray-700">Customer preview</span>
              <div className="min-h-40 flex-1 overflow-y-auto rounded-card border border-gray-100 bg-gray-50 p-4">
                {body.trim() === '' ? (
                  <p className="text-sm text-gray-400">Start typing to preview…</p>
                ) : (
                  <Markdown source={body} />
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div>
          <Button onClick={startPublish} disabled={!canPublish} loading={publishMutation.isPending}>
            Publish…
          </Button>
        </div>
      </Card>

      {dryRunResult ? (
        <Dialog open onClose={() => setDryRunResult(null)} title="Confirm publish">
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              This publishes <span className="font-medium">{KIND_LABELS[kind]}</span> version{' '}
              <span className="font-medium">v{dryRunResult.nextVersion}</span> and retires the
              current version.
            </p>
            <p
              className={`rounded-card px-3 py-2 text-sm font-medium ${
                dryRunResult.customersNeedingResign > 0
                  ? 'bg-warn/10 text-warn'
                  : 'bg-ok/10 text-ok'
              }`}
            >
              {dryRunResult.customersNeedingResign} customer
              {dryRunResult.customersNeedingResign === 1 ? '' : 's'} will be asked to re-sign on
              their next visit
            </p>
            <div className="flex gap-2">
              <Button onClick={confirmPublish} loading={publishMutation.isPending}>
                Publish v{dryRunResult.nextVersion}
              </Button>
              <Button variant="ghost" onClick={() => setDryRunResult(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
