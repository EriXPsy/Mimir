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
import { beadRadius, gutterLabel, layoutWorktreeGraph } from './worktree-map.ts'
import css from './ResearchPanel.module.css'

/** Whole days, rounded for display (the wire carries r3 precision). */
function days(value: number): string {
  return String(Math.max(0, Math.round(value)))
}

/**
 * The branch graph — Sourcetree's form in a clay skin: one vertical lane
 * per research line (time flows top→bottom toward now), declared forks as
 * elbow curves into the child's first bead, adopted lines curve back to
 * their declared parent (the merge), and EVERY work node is a bead —
 * terminal outcomes largest, eureka creations next, weighted work mid,
 * zero-weight touches smallest. Mainline-declaration epochs rule across as
 * dashed horizontals. Compressed time (one row per moment batch, not
 * wall-clock) is stated in the caption; magnitudes live in the list.
 * @param props - the worktree view model and copy.
 * @returns the graph SVG block (or nothing before any lane exists).
 */
function WorktreeGraphStrip({ view, t }: { readonly view: ResearchWorktreeView; readonly t: ResearchT }) {
  const graph = layoutWorktreeGraph(view)
  if (graph.lanes.length === 0) return null
  return (
    <div className={css.worktreeGraphBox} role="img" aria-label={t('worktree.graph')}>
      <svg viewBox={`0 0 ${String(graph.width)} ${String(graph.height)}`} preserveAspectRatio="xMidYMin meet">
        {graph.epochs.map(epoch => (
          <line
            key={`epoch-${epoch.label}-${epoch.at}`}
            x1={0} x2={graph.width} y1={epoch.y} y2={epoch.y}
            className={css.worktreeGraphEpoch}
          >
            <title>{`${epoch.label} · ${epoch.at.slice(0, 10)}`}</title>
          </line>
        ))}
        {graph.forks.map(fork => (
          <path
            key={`fork-${fork.parentLineId}-${fork.childLineId}`}
            className={css.worktreeGraphFork}
            stroke={fork.color}
            d={`M ${String(fork.x1)} ${String(fork.y - 10)} C ${String(fork.x1)} ${String(fork.y - 1)}, ${String(fork.x2)} ${String(fork.y - 10)}, ${String(fork.x2)} ${String(fork.y)}`}
          >
            <title>{`${fork.childLineId} ← ${fork.parentLineId}`}</title>
          </path>
        ))}
        {graph.merges.map(merge => (
          <path
            key={`merge-${merge.childLineId}-${merge.parentLineId}`}
            className={css.worktreeGraphMerge}
            stroke={merge.color}
            d={`M ${String(merge.x1)} ${String(merge.y - 7)} C ${String(merge.x1)} ${String(merge.y + 4)}, ${String(merge.x2)} ${String(merge.y - 8)}, ${String(merge.x2)} ${String(merge.y - 1)}`}
          >
            <title>{`${merge.childLineId} → ${merge.parentLineId} (merged)`}</title>
          </path>
        ))}
        {graph.lanes.map(entry => (
          <line
            key={`lane-${entry.lane.lineId}`}
            x1={entry.x} x2={entry.x} y1={entry.y1} y2={entry.y2}
            className={
              entry.lane.status === 'failed' ? css.worktreeGraphLaneDead
                : entry.lane.status === 'adopted' ? css.worktreeGraphLaneAdopted
                  : entry.isMain ? css.worktreeGraphLaneMain
                    : css.worktreeGraphLane
            }
            stroke={entry.color}
          >
            <title>{`${entry.lane.label} · ${entry.lane.firstSeen.slice(0, 10)} → ${(entry.lane.closedAt ?? entry.lane.lastSeen).slice(0, 10)}`}</title>
          </line>
        ))}
        {graph.beads.map(bead => {
          const key = `bead-${bead.lineId}-${bead.at}-${String(bead.count)}`
          return (
            <g key={key}>
              <circle
                cx={bead.x} cy={bead.y} r={beadRadius(bead.kind, bead.count)}
                className={bead.kind === 'terminal' ? css.worktreeGraphBeadTerminal : css.worktreeGraphBead}
                fill={bead.color}
              >
                <title>{`${bead.lineId} · ${bead.kind} × ${String(bead.count)} · ${bead.at.slice(0, 16).replace('T', ' ')}`}</title>
              </circle>
              {bead.kind === 'terminal' && (
                <text
                  x={bead.x} y={bead.y + 2.2} textAnchor="middle"
                  className={css.worktreeGraphBeadGlyph}
                >
                  {terminalGlyph(view, bead.lineId)}
                </text>
              )}
            </g>
          )
        })}
        <line
          x1={0} x2={graph.width} y1={graph.nowY} y2={graph.nowY}
          className={css.worktreeGraphNow}
        >
          <title>{view.derivedAt.slice(0, 16).replace('T', ' ')}</title>
        </line>
        {graph.lanes.map(entry => (
          <text
            key={`label-${entry.lane.lineId}`}
            x={graph.width - 6} y={entry.y2 + 3} textAnchor="end"
            className={
              entry.lane.status === 'failed' ? css.worktreeGraphLabelDead
                : entry.isMain ? css.worktreeGraphLabelMain
                  : css.worktreeGraphLabel
            }
            fill={entry.color}
          >
            {gutterLabel(entry.lane.label)}
          </text>
        ))}
      </svg>
      <p className={css.worktreeGraphNote}>
        {t('worktree.graph.note')}
        {graph.momentCount > graph.rows
          ? ` · ${t('worktree.graph.compressed', { moments: String(graph.momentCount), rows: String(graph.rows) })}`
          : ''}
      </p>
    </div>
  )
}

/** The lane's terminal glyph on the bead (✗ a documented No, ✓ a merge, ● still walking). */
function terminalGlyph(view: ResearchWorktreeView, lineId: string): string {
  const lane = view.lanes.find(entry => entry.lineId === lineId)
  return lane?.status === 'failed' ? '✗' : lane?.status === 'adopted' ? '✓' : '●'
}

/** One lane row: the glyph, the label, the E0 numbers, and the declared structure. */
function LaneRow({
  lane, isMain, ideaLanes, busy, onSetMainline, onSetParent, onAdopt, onClose, t,
}: {
  readonly lane: ResearchWorktreeLaneView
  readonly isMain: boolean
  readonly ideaLanes: readonly ResearchWorktreeLaneView[]
  readonly busy: boolean
  readonly onSetMainline: (lineId: string) => Promise<ResearchFailureView | null>
  readonly onSetParent: (ideaId: string, parentIdeaId: string | null) => Promise<ResearchFailureView | null>
  readonly onAdopt: (ideaId: string) => Promise<ResearchFailureView | null>
  readonly onClose: (ideaId: string, reason: string) => Promise<ResearchFailureView | null>
  readonly t: ResearchT
}) {
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonState = closeReasonState(reason)
  const closeable = isIdeaLane(lane.lineId) && lane.status === 'open' && !isMain
  const mergeable = isIdeaLane(lane.lineId) && lane.status === 'open'

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
            {mergeable && (
              <button
                type="button"
                className={css.btn}
                disabled={busy}
                onClick={() => { void onAdopt(lane.lineId) }}
              >
                {t('worktree.adopt')}
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
  worktree, refreshWorktree, setMainline, setIdeaParent, adoptIdea, closeIdea, refreshLedger, t,
}: {
  readonly worktree: ResearchWorktreeSlice
  readonly refreshWorktree: () => void
  readonly setMainline: (lineId: string) => Promise<ResearchFailureView | null>
  readonly setIdeaParent: (ideaId: string, parentIdeaId: string | null) => Promise<ResearchFailureView | null>
  readonly adoptIdea: (ideaId: string) => Promise<ResearchFailureView | null>
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
          {/* The branch graph: vertical lanes + forks + merge-backs + beads. */}
          <WorktreeGraphStrip view={view} t={t} />

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
                    onAdopt={ideaId =>
                      run(ideaId, async () => {
                        const failure = await adoptIdea(ideaId)
                        if (failure === null) refreshLedger()
                        return failure
                      })}
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
