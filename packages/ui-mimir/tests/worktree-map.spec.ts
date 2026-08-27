/**
 * Behavior tests for the branch-graph layout (Sourcetree form): preorder
 * track contiguity over the declared forest, fork elbows from the parent
 * column into the child's first row, merge-back elbows for adopted lines,
 * compressed-row budgeting (moments fold into <= MAX_ROWS rows), bead
 * dedup with counts, dangling/cyclic declarations degrading to roots, and
 * determinism against input order.
 * @module dsh-client-ui-mimir/tests/worktree-map.spec
 */

import { describe, expect, it } from 'vitest'
import {
  beadRadius,
  gutterLabel,
  layoutWorktreeGraph,
  WORKTREE_GRAPH_MAX_ROWS,
} from '../src/client/worktree-map.ts'
import type { ResearchWorktreeLaneView, ResearchWorktreeView } from 'dsh-mimir/types'

const NOW = '2026-08-27T10:00:00.000Z'
const BASE = Date.parse('2026-08-01T00:00:00.000Z')

function iso(day: number): string {
  return new Date(BASE + day * 86_400_000).toISOString()
}

function lane(
  lineId: string,
  firstDay: number,
  lastDay: number,
  overrides: Partial<ResearchWorktreeLaneView> = {},
): ResearchWorktreeLaneView {
  return {
    lineId,
    label: lineId,
    status: 'open',
    state: 'exploring',
    parentLineId: null,
    parentLabel: null,
    firstSeen: iso(firstDay),
    lastSeen: iso(lastDay),
    eventCount: 1,
    drift: 0,
    closedAt: null,
    closeReason: null,
    gutDays: null,
    idleDays: 0,
    touches: [],
    ...overrides,
  }
}

function viewOf(lanes: readonly ResearchWorktreeLaneView[]): ResearchWorktreeView {
  return {
    derivedAt: NOW,
    lanes,
    mainline: null,
    mainlineHistory: [],
    counts: { open: lanes.length, failed: 0, adopted: 0 },
  }
}

describe('layoutWorktreeGraph', () => {
  it('keeps subtrees contiguous in preorder and forks from the parent column', () => {
    const lanes = [
      lane('a', 1, 20),
      lane('a1', 5, 15, { parentLineId: 'a' }),
      lane('a1a', 8, 12, { parentLineId: 'a1' }),
      lane('a2', 6, 14, { parentLineId: 'a' }),
      lane('b', 2, 10),
    ]
    const graph = layoutWorktreeGraph(viewOf(lanes))
    const xOf = new Map(graph.lanes.map(entry => [entry.lane.lineId, entry.x]))
    expect([...xOf.keys()]).toEqual(['a', 'a1', 'a1a', 'a2', 'b'])
    expect(xOf.get('a1')!).toBeGreaterThan(xOf.get('a')!) // child to the right
    const fork = graph.forks.find(item => item.childLineId === 'a1')
    expect(fork).toBeDefined()
    expect(fork!.x1).toBe(xOf.get('a'))
    expect(fork!.x2).toBe(xOf.get('a1'))
    // The child lane starts where its fork lands.
    const child = graph.lanes.find(entry => entry.lane.lineId === 'a1')
    expect(fork!.y).toBe(child!.y1)
  })

  it('merges an adopted line back toward its declared parent', () => {
    const lanes = [
      lane('a', 1, 20),
      lane('m', 4, 9, { parentLineId: 'a', status: 'adopted' }),
    ]
    const graph = layoutWorktreeGraph(viewOf(lanes))
    expect(graph.merges).toHaveLength(1)
    expect(graph.merges[0]?.childLineId).toBe('m')
    expect(graph.merges[0]?.x2).toBeLessThan(graph.merges[0]?.x1) // back to the left
  })

  it('folds long histories into the row budget, keeping order', () => {
    const lanes: ResearchWorktreeLaneView[] = [lane('busy', 0, 200)]
    const touches = []
    for (let day = 0; day <= 200; day += 2) {
      touches.push({ at: iso(day), kind: 'work' as const })
    }
    lanes[0] = { ...lanes[0]!, touches }
    const graph = layoutWorktreeGraph(viewOf(lanes))
    expect(graph.rows).toBe(WORKTREE_GRAPH_MAX_ROWS)
    expect(graph.momentCount).toBeGreaterThan(graph.rows)
    const ys = graph.beads.map(bead => bead.y)
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys)) // spread, not stacked
    for (const bead of graph.beads) {
      if (bead.count > 1) expect(beadRadius(bead.kind, bead.count)).toBeGreaterThan(beadRadius(bead.kind, 1))
    }
  })

  it('sizes beads by kind (terminal > create > work > meta)', () => {
    expect(beadRadius('terminal', 1)).toBeGreaterThan(beadRadius('create', 1))
    expect(beadRadius('create', 1)).toBeGreaterThan(beadRadius('work', 1))
    expect(beadRadius('work', 1)).toBeGreaterThan(beadRadius('meta', 1))
  })

  it('degrades dangling and cyclic declarations to roots without crashes', () => {
    const lanes = [
      lane('dangling', 3, 9, { parentLineId: 'ghost' }),
      lane('x', 1, 10, { parentLineId: 'y' }),
      lane('y', 2, 8, { parentLineId: 'x' }),
    ]
    const graph = layoutWorktreeGraph(viewOf(lanes))
    expect(graph.lanes).toHaveLength(3)
    expect(graph.forks).toHaveLength(1) // y <- x only; the backward edge never draws
    expect(graph.forks[0]?.childLineId).toBe('y')
  })

  it('is deterministic against input order and caps the gutter label', () => {
    const lanes = [
      lane('a', 1, 20),
      lane('b', 2, 10),
      lane('a1', 5, 15, { parentLineId: 'a' }),
    ]
    const one = layoutWorktreeGraph(viewOf(lanes))
    const two = layoutWorktreeGraph(viewOf([...lanes].reverse()))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(gutterLabel('Chunk-graph reranking')).toBe('Chunk-graph r…')
    expect(gutterLabel('short')).toBe('short')
  })

  it('ends a failed lane at its close row', () => {
    const lanes = [
      lane('dead', 2, 26, { status: 'failed', closedAt: iso(10), lastSeen: iso(26) }),
      lane('open', 2, 26),
    ]
    const graph = layoutWorktreeGraph(viewOf(lanes))
    const dead = graph.lanes.find(entry => entry.lane.lineId === 'dead')
    const open = graph.lanes.find(entry => entry.lane.lineId === 'open')
    expect(dead!.y2).toBeLessThan(open!.y2) // stops at the documented No
  })
})
