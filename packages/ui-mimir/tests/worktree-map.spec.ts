/**
 * Behavior tests for the branch-map layout (the exploration treasure map's
 * geometry): preorder contiguity over the declared forest, fork placement
 * at the child's first touch (clamped to the parent's start), the
 * visible-track cap, dangling/cyclic declarations degrading to roots
 * instead of crashes, and full determinism against input order.
 * @module dsh-client-ui-mimir/tests/worktree-map.spec
 */

import { describe, expect, it } from 'vitest'
import { layoutWorktreeMap, WORKTREE_MAP_MAX_TRACKS } from '../src/client/worktree-map.ts'
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

describe('layoutWorktreeMap', () => {
  it('keeps every subtree contiguous in preorder (roots by first touch)', () => {
    const lanes = [
      lane('a', 1, 20, { parentLineId: null }),
      lane('a1', 5, 15, { parentLineId: 'a' }),
      lane('a1a', 8, 12, { parentLineId: 'a1' }),
      lane('a2', 6, 14, { parentLineId: 'a' }),
      lane('b', 2, 10),
    ]
    const map = layoutWorktreeMap(viewOf(lanes))
    const order = map.nodes.map(node => node.lane.lineId)
    expect(order).toEqual(['a', 'a1', 'a1a', 'a2', 'b'])
    // Contiguity: a's subtree [a, a1, a1a, a2] is one block.
    expect(order.indexOf('a2') - order.indexOf('a')).toBe(3)
    // Forks: both children fork from a's track above theirs.
    const forkA1 = map.forks.find(fork => fork.childLineId === 'a1')
    const forkA1a = map.forks.find(fork => fork.childLineId === 'a1a')
    expect(forkA1).toBeDefined()
    expect(forkA1a).toBeDefined()
    const trackOf = new Map(map.nodes.map(node => [node.lane.lineId, node.track]))
    expect(trackOf.get('a')).toBeDefined()
    expect(forkA1!.y1).toBeLessThan(forkA1!.y2) // parent above child
    expect(forkA1a!.y1).toBeLessThan(forkA1a!.y2)
  })

  it('rides each fork at the child start, clamped to the parent lifeline start', () => {
    const lanes = [
      lane('root', 2, 20),
      lane('child', 8, 18, { parentLineId: 'root' }),
      lane('early', 1, 5, { parentLineId: 'root' }), // predates the parent: clamped
    ]
    const map = layoutWorktreeMap(viewOf(lanes))
    const child = map.nodes.find(node => node.lane.lineId === 'child')
    const forkChild = map.forks.find(fork => fork.childLineId === 'child')
    expect(child).toBeDefined()
    expect(forkChild).toBeDefined()
    expect(forkChild!.x).toBe(child!.x1) // fork exactly at the child's start
    const root = map.nodes.find(node => node.lane.lineId === 'root')
    const forkEarly = map.forks.find(fork => fork.childLineId === 'early')
    expect(forkEarly).toBeDefined()
    expect(forkEarly!.x).toBeGreaterThanOrEqual(root!.x1) // never left of the parent's lifeline
  })

  it('caps visible tracks and never draws a fork to a hidden lane', () => {
    const lanes: ResearchWorktreeLaneView[] = []
    for (let index = 0; index < WORKTREE_MAP_MAX_TRACKS + 6; index += 1) {
      lanes.push(lane(`n${String(index).padStart(2, '0')}`, index, index + 3, index === 0 ? {} : { parentLineId: 'n00' }))
    }
    const map = layoutWorktreeMap(viewOf(lanes))
    expect(map.nodes).toHaveLength(WORKTREE_MAP_MAX_TRACKS)
    expect(map.hiddenCount).toBe(6)
    for (const fork of map.forks) {
      expect(map.nodes.some(node => node.lane.lineId === fork.childLineId)).toBe(true)
      expect(map.nodes.some(node => node.lane.lineId === fork.parentLineId)).toBe(true)
    }
  })

  it('degrades dangling and cyclic declarations to roots, never crashes', () => {
    const lanes = [
      lane('dangling', 3, 9, { parentLineId: 'ghost' }),
      lane('x', 1, 10, { parentLineId: 'y' }),
      lane('y', 2, 8, { parentLineId: 'x' }), // declared cycle
    ]
    const map = layoutWorktreeMap(viewOf(lanes))
    expect(map.nodes).toHaveLength(3) // nobody is lost
    const ids = map.nodes.map(node => node.lane.lineId)
    expect(ids).toContain('dangling')
    expect(ids).toContain('x')
    expect(ids).toContain('y')
    // Dangling has no edge; the cycle degrades to root(x) + child(y): the
    // true-ancestor edge (y <- x) draws, the backward edge (x <- y) does not.
    expect(map.forks).toHaveLength(1)
    expect(map.forks[0]?.childLineId).toBe('y')
    expect(map.forks[0]?.parentLineId).toBe('x')
  })

  it('is deterministic against input order', () => {
    const lanes = [
      lane('a', 1, 20),
      lane('b', 2, 10),
      lane('a1', 5, 15, { parentLineId: 'a' }),
      lane('b1', 4, 9, { parentLineId: 'b' }),
    ]
    const one = layoutWorktreeMap(viewOf(lanes))
    const two = layoutWorktreeMap(viewOf([...lanes].reverse()))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('ends a failed lane at its close, not at its last touch', () => {
    const lanes = [
      lane('dead', 2, 26, { status: 'failed', closedAt: iso(10), lastSeen: iso(26) }),
    ]
    const map = layoutWorktreeMap(viewOf(lanes))
    const dead = map.nodes.find(node => node.lane.lineId === 'dead')
    const alive = layoutWorktreeMap(viewOf([lane('open', 2, 26)])).nodes[0]!
    expect(dead).toBeDefined()
    expect(dead!.x2).toBeLessThan(alive.x2) // the lifeline stops at the documented No
  })
})
