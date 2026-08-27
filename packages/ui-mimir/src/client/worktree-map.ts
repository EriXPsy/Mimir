/**
 * Pure layout for the worktree's branch-and-mainline map — the exploration
 * map proper: declared derivation edges become fork curves from the parent's
 * track to the child's track at the child's first touch, lane lifelines ride
 * their track, mainline epochs and the now-line stay vertical. Git-graph
 * grammar, leaf-vein gesture: the fork is one soft quadratic bow, nothing
 * more. Deterministic and order-independent: a pure fold over the worktree
 * view — preorder over the declared forest (roots by first touch, then id;
 * children likewise), so every subtree stays contiguous and forks stay
 * short. NOTHING here infers structure: only user-declared parent edges are
 * drawn; a dangling or cyclic declaration degrades to a root, never to a
 * crash. Presentation constants only — no CBE-governed scalars live here.
 * @module dsh-client-ui-mimir/client/worktree-map
 */

import type { ResearchWorktreeLaneView, ResearchWorktreeView } from 'dsh-mimir/types'

/** Visible-track cap (matches the storyline strip it replaces). */
export const WORKTREE_MAP_MAX_TRACKS = 24
/** Map width in viewBox units (horizontal scroll below this width). */
export const WORKTREE_MAP_W = 640
/** One track's height in viewBox units. */
export const WORKTREE_MAP_ROW_H = 14

const PAD_X = 6
const PAD_Y = 4

/** One lane placed on the map: its track, lifeline span, and mainline flag. */
export interface WorktreeMapNode {
  readonly lane: ResearchWorktreeLaneView
  readonly track: number
  readonly y: number
  readonly x1: number
  readonly x2: number
  readonly isMain: boolean
}

/** One declared fork: the curve from the parent's track down to the child's. */
export interface WorktreeMapFork {
  readonly parentLineId: string
  readonly childLineId: string
  readonly x: number
  readonly y1: number
  readonly y2: number
}

/** One mainline-declaration epoch (a dashed vertical). */
export interface WorktreeMapEpoch {
  readonly x: number
  readonly label: string
  readonly at: string
}

/** The whole map geometry, ready for a single deterministic SVG render. */
export interface WorktreeMapLayout {
  readonly width: number
  readonly height: number
  readonly nodes: readonly WorktreeMapNode[]
  readonly forks: readonly WorktreeMapFork[]
  readonly epochs: readonly WorktreeMapEpoch[]
  readonly nowX: number
  readonly hiddenCount: number
}

interface Candidate {
  readonly lane: ResearchWorktreeLaneView
  readonly firstMs: number
  readonly endMs: number
}

function parseMs(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * @param view - the derived worktree (lanes in ANY order; sorted internally).
 * @returns the deterministic map layout (empty nodes when no lane exists).
 */
export function layoutWorktreeMap(view: ResearchWorktreeView): WorktreeMapLayout {
  const mainlineId = view.mainline?.lineId ?? null

  const candidates = new Map<string, Candidate>()
  for (const lane of view.lanes) {
    const firstMs = parseMs(lane.firstSeen)
    if (firstMs === null) continue
    const closedMs = lane.status === 'failed' && lane.closedAt !== null ? parseMs(lane.closedAt) : null
    const lastMs = parseMs(lane.lastSeen)
    const endMs = closedMs ?? lastMs ?? firstMs
    candidates.set(lane.lineId, { lane, firstMs, endMs: Math.max(endMs, firstMs) })
  }

  // The declared forest: children grouped under existing, non-self parents.
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const [lineId, candidate] of candidates) {
    const parent = candidate.lane.parentLineId
    if (parent !== null && parent !== lineId && candidates.has(parent)) {
      const list = childrenOf.get(parent) ?? []
      list.push(lineId)
      childrenOf.set(parent, list)
      continue
    }
    roots.push(lineId) // root, dangling parent, or self-loop declaration
  }

  const byFirst = (a: string, b: string): number => {
    const ca = candidates.get(a)
    const cb = candidates.get(b)
    const fa = ca?.firstMs ?? 0
    const fb = cb?.firstMs ?? 0
    return fa - fb || a.localeCompare(b)
  }
  roots.sort(byFirst)
  for (const list of childrenOf.values()) list.sort(byFirst)

  // Preorder walk: every subtree contiguous, parent tracks above children.
  const ordered: string[] = []
  const visited = new Set<string>()
  const walk = (lineId: string): void => {
    if (visited.has(lineId)) return
    visited.add(lineId)
    ordered.push(lineId)
    for (const child of childrenOf.get(lineId) ?? []) walk(child)
  }
  for (const root of roots) walk(root)
  // Cycle-only nodes never surface from roots; degrade them to roots-at-end.
  const stranded = [...candidates.keys()].filter(lineId => !visited.has(lineId)).sort(byFirst)
  for (const lineId of stranded) walk(lineId)

  const hiddenCount = Math.max(0, ordered.length - WORKTREE_MAP_MAX_TRACKS)
  const visible = ordered.slice(0, WORKTREE_MAP_MAX_TRACKS)

  const nowMs = parseMs(view.derivedAt)
  const epochMs = view.mainlineHistory
    .map(declaration => ({ declaration, ms: parseMs(declaration.declaredAt) }))
    .filter((entry): entry is { declaration: ResearchWorktreeView['mainlineHistory'][number]; ms: number } =>
      entry.ms !== null)

  const times: number[] = [nowMs ?? 0]
  for (const lineId of visible) {
    const candidate = candidates.get(lineId)
    if (candidate === undefined) continue
    times.push(candidate.firstMs, candidate.endMs)
  }
  for (const entry of epochMs) times.push(entry.ms)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const span = tMax - tMin || 1
  const x = (ms: number): number => PAD_X + ((ms - tMin) / span) * (WORKTREE_MAP_W - PAD_X * 2)

  const nodes: WorktreeMapNode[] = visible.map((lineId, track) => {
    const candidate = candidates.get(lineId)
    if (candidate === undefined) throw new Error('unreachable: visible ids come from candidates')
    return {
      lane: candidate.lane,
      track,
      y: PAD_Y + track * WORKTREE_MAP_ROW_H + WORKTREE_MAP_ROW_H / 2,
      x1: x(candidate.firstMs),
      x2: x(candidate.endMs),
      isMain: lineId === mainlineId,
    }
  })

  const nodeByLine = new Map(nodes.map(node => [node.lane.lineId, node]))
  const forks: WorktreeMapFork[] = []
  for (const node of nodes) {
    const parent = node.lane.parentLineId
    if (parent === null || parent === node.lane.lineId) continue
    const parentNode = nodeByLine.get(parent)
    if (parentNode === undefined) continue // capped or dangling: no edge drawn
    if (parentNode.track >= node.track) continue // cycle-degraded: not an ancestor in layout
    const candidate = candidates.get(node.lane.lineId)
    const parentCandidate = candidates.get(parent)
    if (candidate === undefined || parentCandidate === undefined) continue
    // The fork rides the child's first touch, clamped to the parent's start.
    const forkMs = Math.max(candidate.firstMs, parentCandidate.firstMs)
    forks.push({
      parentLineId: parent,
      childLineId: node.lane.lineId,
      x: x(forkMs),
      y1: parentNode.y,
      y2: node.y,
    })
  }

  const epochs: WorktreeMapEpoch[] = epochMs.map(entry => ({
    x: x(entry.ms),
    label: entry.declaration.label,
    at: entry.declaration.declaredAt,
  }))

  const height = visible.length * WORKTREE_MAP_ROW_H + PAD_Y * 2 + (hiddenCount > 0 ? 12 : 0)

  return Object.freeze({
    width: WORKTREE_MAP_W,
    height,
    nodes: Object.freeze(nodes),
    forks: Object.freeze(forks),
    epochs: Object.freeze(epochs),
    nowX: x(nowMs ?? tMax),
    hiddenCount,
  })
}
