/**
 * The worktree (S2) card of the ledger view: the research process rendered
 * as a git-like working tree — lanes (branches) grouped mainline-first,
 * then open, then merged (✓), then dead ends (✗, each with its documented
 * No: the reason and the days since the lane's last touch at close). The
 * three structural writes are the user's own declarations (the mainline ref
 * move, the derivation edge, the close); the system never infers or ranks.
 * All reads and writes flow through the injected controller verbs; this
 * component owns only the close-reason draft and the per-lane busy state.
 * @module dsh-client-ui-mimir/client/WorktreeView
 */

import { useState } from 'react'
import type { ResearchWorktreeLaneView, ResearchWorktreeView } from 'dsh-mimir/types'
import type { ResearchWorktreeSlice, ResearchFailureView } from './controller.ts'
import type { ResearchKey } from './locales.ts'
import type { ResearchT } from './view-common.ts'
import { closeReasonState, isIdeaLane, WORKTREE_REASON_MAX_CHARS } from './worktree-view.ts'
import css from './ResearchPanel.module.css'

/** Whole days, rounded for display (the wire carries r3 precision). */
function days(value: number): string {
  return String(Math.max(0, Math.round(value)))
}

/**
 * The storyline strip (Ogawa & Ma's software-evolution storylines, v1.5
 * minimal): one horizontal lifeline per lane — declared → last touch (or
 * close) — with the mainline-declaration epochs as dashed verticals and
 * a solid now-line. Pure SVG over E0 timestamps; no zoom, no smoothing,
 * no stacking — the ③ v1.5 floor. Glyphs repeat the list's vocabulary
 * (● mainline, ⌥ open, ✓ adopted, ✗ dead end) so the strip never adds a
 * second visual grammar.
 * @param props - the worktree view model.
 * @returns the storyline SVG (or nothing before any lane exists).
 */
function StorylineStrip({ view }: { readonly view: ResearchWorktreeView }) {
  const rows = view.lanes.slice(0, 24)
  if (rows.length === 0) return null
  const nowMs = Date.parse(view.derivedAt)
  const times: number[] = [nowMs]
  for (const lane of rows) {
    const first = Date.parse(lane.firstSeen)
    const end = lane.status === 'failed' && lane.closedAt !== null
      ? Date.parse(lane.closedAt)
      : Date.parse(lane.lastSeen)
    if (Number.isFinite(first)) times.push(first)
    if (Number.isFinite(end)) times.push(end)
  }
  for (const epoch of view.mainlineHistory) {
    const at = Date.parse(epoch.declaredAt)
    if (Number.isFinite(at)) times.push(at)
  }
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const span = tMax - tMin || 1
  const W = 640
  const ROW_H = 14
  const PAD_X = 6
  const height = rows.length * ROW_H + 6
  const x = (ms: number): number => PAD_X + ((ms - tMin) / span) * (W - PAD_X * 2)
  return (
    <div className={css.worktreeStory} role="img" aria-label="storyline">
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} preserveAspectRatio="none">
        {view.mainlineHistory.map(epoch => {
          const at = Date.parse(epoch.declaredAt)
          if (!Number.isFinite(at)) return null
          return (
            <line
              key={`epoch-${epoch.lineId}-${epoch.declaredAt}`}
              x1={x(at)} x2={x(at)} y1={2} y2={height - 2}
              className={css.worktreeStoryEpoch}
            >
              <title>{`${epoch.label} · ${epoch.declaredAt.slice(0, 10)}`}</title>
            </line>
          )
        })}
        <line
          x1={x(nowMs)} x2={x(nowMs)} y1={2} y2={height - 2}
          className={css.worktreeStoryNow}
        />
        {rows.map((lane, index) => {
          const first = Date.parse(lane.firstSeen)
          const end = lane.status === 'failed' && lane.closedAt !== null
            ? Date.parse(lane.closedAt)
            : Date.parse(lane.lastSeen)
          if (!Number.isFinite(first) || !Number.isFinite(end)) return null
          const y = index * ROW_H + ROW_H / 2 + 2
          const isMain = view.mainline?.lineId === lane.lineId
          return (
            <g key={`lane-${lane.lineId}`}>
              <line
                x1={x(first)} x2={x(end)} y1={y} y2={y}
                className={
                  isMain ? css.worktreeStoryMain
                    : lane.status === 'failed' ? css.worktreeStoryDead
                      : lane.status === 'adopted' ? css.worktreeStoryMerged
                        : css.worktreeStoryOpen
                }
              >
                <title>{`${lane.label} · ${lane.firstSeen.slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)}`}</title>
              </line>
              <text x={x(end) + 3} y={y + 3} className={css.worktreeStoryGlyph}>
                {isMain ? '●' : lane.status === 'failed' ? '✗' : lane.status === 'adopted' ? '✓' : '⌥'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** One lane row: the glyph, the label, the E0 numbers, and the declared structure. */
function LaneRow({
  lane, isMain, ideaLanes, busy, onSetMainline, onSetParent, onClose, t,
}: {
  readonly lane: ResearchWorktreeLaneView
  readonly isMain: boolean
  readonly ideaLanes: readonly ResearchWorktreeLaneView[]
  readonly busy: boolean
  readonly onSetMainline: (lineId: string) => Promise<ResearchFailureView | null>
  readonly onSetParent: (ideaId: string, parentIdeaId: string | null) => Promise<ResearchFailureView | null>
  readonly onClose: (ideaId: string, reason: string) => Promise<ResearchFailureView | null>
  readonly t: ResearchT
}) {
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonState = closeReasonState(reason)
  const closeable = isIdeaLane(lane.lineId) && lane.status === 'open' && !isMain

  const onParentChange = async (value: string): Promise<void> => {
    if (busy) return
    const failure = await onSetParent(lane.lineId, value === '' ? null : value)
    if (failure !== null) setError(failure.message)
  }

  const onConfirmClose = async (): Promise<void> => {
    if (reasonState !== 'ok') return
    const failure = await onClose(lane.lineId, reason)
    if (failure !== null) {
      setError(failure.message)
      return
    }
    setClosing(false)
    setReason('')
    setError(null)
  }

  return (
    <li className={css.worktreeLane} data-status={lane.status} data-main={isMain || undefined}>
      <span className={css.worktreeGlyph} data-status={lane.status} aria-hidden>
        {lane.status === 'failed' ? '✗' : lane.status === 'adopted' ? '✓' : '●'}
      </span>
      <div className={css.worktreeLaneBody}>
        <div className={css.worktreeLaneHead}>
          <span className={css.worktreeLaneLabel}>{lane.label}</span>
          {isMain && <span className={css.worktreeMainBadge}>{t('worktree.mainline')}</span>}
        </div>
        <div className={css.worktreeLaneMeta}>
          <span title={`${lane.firstSeen} → ${lane.lastSeen}`}>
            {new Date(lane.lastSeen).toLocaleDateString()}
          </span>
          <span>{t('worktree.lane.events', { count: String(lane.eventCount) })}</span>
          <span>{t('worktree.lane.drift', { value: String(lane.drift) })}</span>
          {lane.status === 'open' && lane.idleDays !== null && (
            <span>{t('worktree.idle', { days: days(lane.idleDays) })}</span>
          )}
          {lane.status === 'failed' && lane.gutDays !== null && (
            <span>{t('worktree.gut', { days: days(lane.gutDays) })}</span>
          )}
        </div>
        {lane.status === 'failed' && lane.closeReason !== null && (
          <p className={css.worktreeReason}>{lane.closeReason}</p>
        )}
        {isIdeaLane(lane.lineId) && lane.status !== 'failed' && (
          <div className={css.worktreeParent}>
            <label
              className={css.worktreeParentLabel}
              htmlFor={`mimir-worktree-parent-${lane.lineId}`}
            >
              {t('worktree.parent.label')}
            </label>
            <select
              id={`mimir-worktree-parent-${lane.lineId}`}
              className={css.worktreeSelect}
              value={lane.parentLineId ?? ''}
              disabled={busy}
              onChange={event => { void onParentChange(event.target.value) }}
            >
              <option value="">{t('worktree.parent.none')}</option>
              {ideaLanes.filter(other => other.lineId !== lane.lineId).map(other => (
                <option key={other.lineId} value={other.lineId}>
                  {other.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {lane.status === 'open' && (
          <div className={css.worktreeActions}>
            {!isMain && (
              <button
                type="button"
                className={css.btn}
                disabled={busy}
                onClick={() => { void onSetMainline(lane.lineId) }}
              >
                {t('worktree.mainline.set')}
              </button>
            )}
            {closeable && (
              <button
                type="button"
                className={css.btn}
                disabled={busy}
                onClick={() => { setClosing(!closing); setError(null) }}
              >
                {t('worktree.close')}
              </button>
            )}
          </div>
        )}
        {closing && closeable && (
          <div className={css.worktreeCloseBox}>
            <label
              className={css.worktreeParentLabel}
              htmlFor={`mimir-worktree-close-${lane.lineId}`}
            >
              {t('worktree.close.reason')}
            </label>
            <input
              id={`mimir-worktree-close-${lane.lineId}`}
              className={css.worktreeCloseInput}
              type="text"
              value={reason}
              onChange={event => { setReason(event.target.value) }}
            />
            <span className={css.worktreeCount} data-over={reasonState === 'too-long' || undefined}>
              {reason.length}/{WORKTREE_REASON_MAX_CHARS}
            </span>
            {reasonState === 'too-long' && (
              <span className={css.worktreeOver}>
                {t('worktree.close.tooLong', { count: String(WORKTREE_REASON_MAX_CHARS) })}
              </span>
            )}
            <div className={css.worktreeActions}>
              <button
                type="button"
                className={css.btnPrimary}
                disabled={reasonState !== 'ok' || busy}
                onClick={() => { void onConfirmClose() }}
              >
                {t('worktree.close.confirm')}
              </button>
              <button
                type="button"
                className={css.btn}
                onClick={() => { setClosing(false); setError(null) }}
              >
                {t('worktree.close.cancel')}
              </button>
            </div>
          </div>
        )}
        {error !== null && <p className={css.failure} role="status">{error}</p>}
      </div>
    </li>
  )
}

/**
 * @param props - the worktree slice, the controller verbs, and copy.
 * @returns the worktree card (banner + grouped lanes + counts).
 */
export function WorktreeView({
  worktree, refreshWorktree, setMainline, setIdeaParent, closeIdea, refreshLedger, t,
}: {
  readonly worktree: ResearchWorktreeSlice
  readonly refreshWorktree: () => void
  readonly setMainline: (lineId: string) => Promise<ResearchFailureView | null>
  readonly setIdeaParent: (ideaId: string, parentIdeaId: string | null) => Promise<ResearchFailureView | null>
  readonly closeIdea: (ideaId: string, reason: string) => Promise<ResearchFailureView | null>
  /** Refresh the ledger timeline (a documented No lands as a ledger event too). */
  readonly refreshLedger: () => void
  readonly t: ResearchT
}) {
  const [busyLane, setBusyLane] = useState<string | null>(null)

  const view = worktree.view
  const mainlineId = view?.mainline?.lineId ?? null
  const lanes = view?.lanes ?? []
  const ideaLanes = lanes.filter(lane => isIdeaLane(lane.lineId))
  const groups: readonly { key: ResearchKey; lanes: readonly ResearchWorktreeLaneView[] }[] = [
    { key: 'worktree.group.open', lanes: lanes.filter(lane => lane.status === 'open') },
    { key: 'worktree.group.adopted', lanes: lanes.filter(lane => lane.status === 'adopted') },
    { key: 'worktree.group.failed', lanes: lanes.filter(lane => lane.status === 'failed') },
  ]

  const run = async (
    laneId: string,
    action: () => Promise<ResearchFailureView | null>,
  ): Promise<ResearchFailureView | null> => {
    if (busyLane !== null) return null
    setBusyLane(laneId)
    const failure = await action()
    setBusyLane(null)
    return failure
  }

  return (
    <section className={css.reportCard}>
      <div className={css.reportCardHead}>
        <h3 className={css.reportCardTitle}>{t('worktree.title')}</h3>
        <div className={css.viewActions}>
          <button
            type="button"
            className={css.btn}
            onClick={refreshWorktree}
            disabled={worktree.status === 'loading'}
          >
            {t('worktree.refresh')}
          </button>
        </div>
      </div>
      {(worktree.status === 'cold' || worktree.status === 'loading') && (
        <p className={css.hint}>{t('worktree.loading')}</p>
      )}
      {worktree.status === 'error' && (
        <p className={css.failure} role="status">
          {worktree.failure?.message ?? t('worktree.failed')}
          <button type="button" className={css.retry} onClick={refreshWorktree}>
            {t('error.retry')}
          </button>
        </p>
      )}
      {worktree.status === 'ready' && view !== null && (
        <>
          <div className={css.worktreeBanner}>
            <span className={css.worktreeBannerKind}>{t('worktree.mainline')}</span>
            {view.mainline === null
              ? <span className={css.worktreeBannerMain}>{t('worktree.mainline.none')}</span>
              : (
                <>
                  <span className={css.worktreeBannerMain}>{view.mainline.label}</span>
                  <span className={css.worktreeBannerMeta}>
                    {t('worktree.mainline.declaredAt')} {new Date(view.mainline.declaredAt).toLocaleDateString()}
                    {view.mainlineHistory.length > 1
                      ? ` · reflog × ${String(view.mainlineHistory.length)}`
                      : ''}
                  </span>
                </>
              )}
          </div>
          {/* The storyline strip: lifelines + epoch lines + the now-line. */}
          <StorylineStrip view={view} />

          {lanes.length === 0 && <p className={css.hint}>{t('worktree.empty')}</p>}
          {groups.map(group => group.lanes.length === 0 ? null : (
            <div key={group.key} className={css.worktreeGroup}>
              <h4 className={css.worktreeGroupTitle}>{t(group.key)}</h4>
              <ul className={css.worktreeList}>
                {group.lanes.map(lane => (
                  <LaneRow
                    key={lane.lineId}
                    lane={lane}
                    isMain={lane.lineId === mainlineId}
                    ideaLanes={ideaLanes}
                    busy={busyLane !== null}
                    onSetMainline={lineId => run(lineId, () => setMainline(lineId))}
                    onSetParent={(ideaId, parentIdeaId) =>
                      run(ideaId, () => setIdeaParent(ideaId, parentIdeaId))}
                    onClose={(ideaId, reason) =>
                      run(ideaId, async () => {
                        const failure = await closeIdea(ideaId, reason)
                        if (failure === null) refreshLedger()
                        return failure
                      })}
                    t={t}
                  />
                ))}
              </ul>
            </div>
          ))}
          <p className={css.worktreeCounts}>
            <span className={css.statChip}>{t('worktree.group.open')} × {String(view.counts.open)}</span>
            <span className={css.statChip}>{t('worktree.group.adopted')} × {String(view.counts.adopted)}</span>
            <span className={css.statChip}>{t('worktree.group.failed')} × {String(view.counts.failed)}</span>
          </p>
        </>
      )}
    </section>
  )
}
