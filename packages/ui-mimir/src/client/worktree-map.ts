/**
 * Pure layout for the worktree's branch graph — the Sourcetree form, clay
 * skin applied at render: ONE vertical lane per research line (time flows
 * top→bottom toward now), declared derivation edges as fork elbows, adopted
 * lines merge back toward their declared parent, and EVERY work node is a
 * bead on its lane (terminal > create > work > meta on the bead scale).
 *
 * Time is COMPRESSED, Sourcetree-style: one grid row per moment batch, not
 * wall-clock proportion — the caption says so; GUT/idle magnitudes live in
 * the list's numbers, the map carries topology and sequence.
 *
 * Deterministic and order-independent: a pure fold over the worktree view.
 * Preorder over the declared forest (roots by first touch, then id;
 * children likewise) keeps every subtree contiguous with short forks.
 * NOTHING here infers structure: only user-declared parent edges draw; a
 * dangling or cyclic declaration degrades to a root, never a crash.
 * Presentation constants only — no CBE-governed scalars live here.
 * @module dsh-client-ui-mimir/client/worktree-map
 */

import type {
  ResearchWorktreeLaneView,
  ResearchWorktreeTouchKind,
  ResearchWorktreeView,
} from 'dsh-mimir/types'

/** Visible-row budget (moments beyond it compress into shared rows). */
export const WORKTREE_GRAPH_MAX_ROWS = 24
/** One lane's column width in viewBox units. */
export const WORKTREE_GRAPH_LANE_W = 18
/** One grid row's height in viewBox units. */
export const WORKTREE_GRAPH_ROW_H = 16
/** Visible-track cap. */
export const WORKTREE_GRAPH_MAX_TRACKS = 24
/** Label-gutter width in viewBox units. */
export const WORKTREE_GRAPH_LABEL_GUTTER = 128
/**
 * The lane palette: eight macaron-distinct hues (Sourcetree gives every
 * branch its own color; these stay soft enough for the clay skin).
 */
export const WORKTREE_GRAPH_PALETTE: readonly string[] = Object.freeze([
  '#d98a68', '#94b89b', '#85a7c6', '#bfa3c9',
  '#d4b06e', '#8ab8ab', '#cf9aa6', '#9aa3b8',
])

const PAD_TOP = 12
const PAD_BOTTOM = 18
const PAD_LEFT = 8

function parseMs(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** One placed lane: its column, vertical span, color, and gutter label. */
export interface WorktreeGraphLane {
  readonly lane: ResearchWorktreeLaneView
  readonly x: number
  readonly y1: number
  readonly y2: number
  readonly color: string
  readonly isMain: boolean
}

/** One work node: a bead on its lane's column at a compressed row. */
export interface WorktreeGraphBead {
  readonly lineId: string
  readonly x: number
  readonly y: number
  readonly kind: ResearchWorktreeTouchKind
  readonly at: string
  readonly count: number
  readonly color: string
}

/** One declared fork elbow: parent column → child column at the fork row. */
export interface WorktreeGraphFork {
  readonly parentLineId: string
  readonly childLineId: string
  readonly x1: number
  readonly x2: number
  readonly y: number
  readonly color: string
}

/** One merge-back elbow: an adopted line curving to its declared parent. */
export interface WorktreeGraphMerge {
  readonly childLineId: string
  readonly parentLineId: string
  readonly x1: number
  readonly x2: number
  readonly y: number
  readonly color: string
}

/** One mainline-declaration epoch (a dashed horizontal rule). */
export interface WorktreeGraphEpoch {
  readonly y: number
  readonly label: string
  readonly at: string
}

/** The whole graph geometry, ready for one deterministic SVG render. */
export interface WorktreeGraphLayout {
  readonly width: number
  readonly height: number
  readonly rows: number
  readonly momentCount: number
  readonly lanes: readonly WorktreeGraphLane[]
  readonly beads: readonly WorktreeGraphBead[]
  readonly forks: readonly WorktreeGraphFork[]
  readonly merges: readonly WorktreeGraphMerge[]
  readonly epochs: readonly WorktreeGraphEpoch[]
  readonly nowY: number
}

const BEAD_RANK: Readonly<Record<ResearchWorktreeTouchKind, number>> = {
  terminal: 3, create: 2, work: 1, meta: 0,
}

/**
 * @param view - the derived worktree (lanes in ANY order; sorted internally).
 * @returns the deterministic vertical branch-graph layout (empty lanes when
 *  no parseable lane exists).
 */
export function layoutWorktreeGraph(view: ResearchWorktreeView): WorktreeGraphLayout {
  const mainlineId = view.mainline?.lineId ?? null

  const candidates = new Map<string, ResearchWorktreeLaneView>()
  for (const lane of view.lanes) {
    if (parseMs(lane.firstSeen) === null) continue
    candidates.set(lane.lineId, lane)
  }

  // ── The declared forest: preorder, roots by first touch, children after.
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const [lineId, lane] of candidates) {
    const parent = lane.parentLineId
    if (parent !== null && parent !== lineId && candidates.has(parent)) {
      const list = childrenOf.get(parent) ?? []
      list.push(lineId)
      childrenOf.set(parent, list)
      continue
    }
    roots.push(lineId)
  }
  const firstMsOf = (lineId: string): number => parseMs(candidates.get(lineId)?.firstSeen ?? '') ?? 0
  const byFirst = (a: string, b: string): number =>
    firstMsOf(a) - firstMsOf(b) || a.localeCompare(b)
  roots.sort(byFirst)
  for (const list of childrenOf.values()) list.sort(byFirst)
  const ordered: string[] = []
  const visited = new Set<string>()
  const walk = (lineId: string): void => {
    if (visited.has(lineId)) return
    visited.add(lineId)
    ordered.push(lineId)
    for (const child of childrenOf.get(lineId) ?? []) walk(child)
  }
  for (const root of roots) walk(root)
  for (const lineId of [...candidates.keys()].filter(id => !visited.has(id)).sort(byFirst)) walk(lineId)

  const trackOf = new Map<string, number>()
  ordered.slice(0, WORKTREE_GRAPH_MAX_TRACKS).forEach((lineId, track) => { trackOf.set(lineId, track) })
  const xOf = (track: number): number => PAD_LEFT + track * WORKTREE_GRAPH_LANE_W + WORKTREE_GRAPH_LANE_W / 2

  // ── Moments: every first touch, every bead, every end, epochs, now.
  const moments = new Set<string>()
  for (const lane of candidates.values()) {
    moments.add(lane.firstSeen)
    moments.add(lane.closedAt ?? lane.lastSeen)
    for (const touch of lane.touches) moments.add(touch.at)
  }
  for (const declaration of view.mainlineHistory) moments.add(declaration.declaredAt)
  moments.add(view.derivedAt)
  const sorted = [...moments].sort()
  const rows = Math.min(sorted.length, WORKTREE_GRAPH_MAX_ROWS)
  const rowIndexOf = (ts: string): number => {
    let low = 0
    let high = sorted.length - 1
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (sorted[mid]! < ts) low = mid + 1
      else high = mid
    }
    return low
  }
  const rowOf = (ts: string): number =>
    Math.min(rows - 1, Math.floor(rowIndexOf(ts) * rows / sorted.length))
  const yOf = (row: number): number => PAD_TOP + row * WORKTREE_GRAPH_ROW_H

  // ── Lanes.
  const lanes: WorktreeGraphLane[] = []
  for (const [lineId, track] of trackOf) {
    const lane = candidates.get(lineId)
    if (lane === undefined) continue
    lanes.push({
      lane,
      x: xOf(track),
      y1: yOf(rowOf(lane.firstSeen)),
      y2: yOf(rowOf(lane.closedAt ?? lane.lastSeen)),
      color: WORKTREE_GRAPH_PALETTE[track % WORKTREE_GRAPH_PALETTE.length] ?? '#9aa3b8',
      isMain: lineId === mainlineId,
    })
  }
  const lanePlaced = new Map(lanes.map(entry => [entry.lane.lineId, entry]))

  // ── Beads (work nodes), compressed-row dedup with a count.
  const beads: WorktreeGraphBead[] = []
  for (const entry of lanes) {
    const byRow = new Map<number, { at: string; kind: ResearchWorktreeTouchKind; count: number }>()
    for (const touch of entry.lane.touches) {
      const row = rowOf(touch.at)
      const slot = byRow.get(row)
      if (slot === undefined) {
        byRow.set(row, { at: touch.at, kind: touch.kind, count: 1 })
        continue
      }
      slot.count += 1
      if (BEAD_RANK[touch.kind] > BEAD_RANK[slot.kind]) slot.kind = touch.kind
      if (touch.at < slot.at) slot.at = touch.at
    }
    for (const [row, slot] of byRow) {
      beads.push({
        lineId: entry.lane.lineId,
        x: entry.x,
        y: yOf(row),
        kind: slot.kind,
        at: slot.at,
        count: slot.count,
        color: entry.color,
      })
    }
  }

  // ── Forks + merge-backs (declared edges only, true ancestors only).
  const forks: WorktreeGraphFork[] = []
  const merges: WorktreeGraphMerge[] = []
  for (const entry of lanes) {
    const parent = entry.lane.parentLineId
    if (parent === null || parent === entry.lane.lineId) continue
    const parentEntry = lanePlaced.get(parent)
    if (parentEntry === undefined) continue
    if (parentEntry.x >= entry.x) continue // cycle-degraded: not an ancestor
    forks.push({
      parentLineId: parent,
      childLineId: entry.lane.lineId,
      x1: parentEntry.x,
      x2: entry.x,
      y: entry.y1,
      color: entry.color,
    })
    if (entry.lane.status === 'adopted') {
      merges.push({
        childLineId: entry.lane.lineId,
        parentLineId: parent,
        x1: entry.x,
        x2: parentEntry.x,
        y: entry.y2,
        color: entry.color,
      })
    }
  }

  const epochs: WorktreeGraphEpoch[] = view.mainlineHistory.map(declaration => ({
    y: yOf(rowOf(declaration.declaredAt)),
    label: declaration.label,
    at: declaration.declaredAt,
  }))

  const width = PAD_LEFT + Math.min(trackOf.size, WORKTREE_GRAPH_MAX_TRACKS) * WORKTREE_GRAPH_LANE_W
    + WORKTREE_GRAPH_LABEL_GUTTER
  const height = yOf(Math.max(0, rows - 1)) + PAD_BOTTOM

  return Object.freeze({
    width,
    height,
    rows,
    momentCount: sorted.length,
    lanes: Object.freeze(lanes),
    beads: Object.freeze(beads),
    forks: Object.freeze(forks),
    merges: Object.freeze(merges),
    epochs: Object.freeze(epochs),
    nowY: yOf(rowOf(view.derivedAt)),
  })
}

/** A bead's radius on the bead scale (bumped when a row merged several). */
export function beadRadius(kind: ResearchWorktreeTouchKind, count: number): number {
  const base = kind === 'terminal' ? 4.2 : kind === 'create' ? 3.6 : kind === 'work' ? 2.6 : 2
  return count > 1 ? base + 0.6 : base
}

/** Gutter-label text: capped, with an ellipsis when it overflows. */
export function gutterLabel(label: string, max = 14): string {
  return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`
}
