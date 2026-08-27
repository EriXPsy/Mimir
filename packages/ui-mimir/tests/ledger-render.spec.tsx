/**
 * Render smoke for the ledger view's derived cards: server-renders the real
 * LedgerView with ready worktree (S2) + foraging (S4) slices and asserts the
 * storyline strip, the territory ledger, and the GUT copy actually reach
 * HTML. Guards against render-time crashes that pure-logic tests cannot see
 * (found once in the batch-5 audit: a storyline tooltip calling
 * Date#toISOString on a millisecond number). Stubbed slice data only; the
 * full real-service path is exercised by the mimir-side wiring tests.
 * @module dsh-client-ui-mimir/tests/ledger-render.spec
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import type {
  ResearchForagingView,
  ResearchWorktreeView,
} from 'dsh-mimir/types'
import { LedgerView } from '../src/client/LedgerView.tsx'
import type {
  ResearchBriefSlice,
  ResearchForagingSlice,
  ResearchLedgerSlice,
  ResearchReportSlice,
  ResearchWorktreeSlice,
} from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import type { ResearchKey } from '../src/client/locales.ts'
import type { ResearchT } from '../src/client/view-common.ts'

function t(key: ResearchKey, params?: Record<string, string>): string {
  let text: string = zh[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value)
  }
  return text
}

const DAY = 86_400_000
const NOW = '2026-08-27T10:00:00.000Z'
const nowMs = Date.parse(NOW)
const iso = (daysAgo: number): string => new Date(nowMs - daysAgo * DAY).toISOString()

const WORKTREE: ResearchWorktreeView = {
  derivedAt: NOW,
  lanes: [
    {
      lineId: 'i1', label: 'Chunk-graph reranking', status: 'open', state: 'dominant',
      parentLineId: null, parentLabel: null,
      firstSeen: iso(12), lastSeen: iso(0), eventCount: 3, drift: 1.9,
      closedAt: null, closeReason: null, gutDays: null, idleDays: 0,
    },
    {
      lineId: 'i2', label: 'Hybrid sparse-dense routing', status: 'failed', state: 'settled',
      parentLineId: 'i1', parentLabel: 'Chunk-graph reranking',
      firstSeen: iso(10), lastSeen: iso(2), eventCount: 2, drift: -0.8,
      closedAt: iso(0), closeReason: 'no measurable gain', gutDays: 2, idleDays: null,
    },
    {
      lineId: 'i3', label: 'Late-interaction pooling', status: 'adopted', state: 'settled',
      parentLineId: 'i1', parentLabel: 'Chunk-graph reranking',
      firstSeen: iso(8), lastSeen: iso(3), eventCount: 2, drift: 0.9,
      closedAt: null, closeReason: null, gutDays: null, idleDays: null,
    },
    {
      lineId: 'project:p1', label: 'Long-context retrieval', status: 'open', state: 'converging',
      parentLineId: null, parentLabel: null,
      firstSeen: iso(9), lastSeen: iso(1), eventCount: 5, drift: 2.2,
      closedAt: null, closeReason: null, gutDays: null, idleDays: 1,
    },
  ],
  mainline: { lineId: 'i1', label: 'Chunk-graph reranking', declaredAt: iso(0) },
  mainlineHistory: [{ lineId: 'i1', label: 'Chunk-graph reranking', declaredAt: iso(0) }],
  counts: { open: 2, failed: 1, adopted: 1 },
}

const FORAGING: ResearchForagingView = {
  derivedAt: NOW,
  territories: [
    {
      projectId: 'p1', label: 'Long-context retrieval', eventCount: 12,
      firstSeen: iso(9), lastSeen: iso(1), activityMass: 4.2,
      harvestCount: 1, lastHarvestAt: iso(5), daysSinceHarvest: 5, daysSinceActivity: 1,
    },
    {
      projectId: 'p2', label: 'Claim atlas', eventCount: 0,
      firstSeen: '', lastSeen: '', activityMass: 0,
      harvestCount: 0, lastHarvestAt: null, daysSinceHarvest: null, daysSinceActivity: 0,
    },
  ],
  baseline: { samples: 5, medianDays: 6, iqrDays: 4, minSamples: 5, speaks: true },
  cards: [
    { projectId: 'p1', label: 'Long-context retrieval', daysSinceHarvest: 5, daysSinceActivity: 1, baselineMedianDays: 6 },
    { projectId: 'p2', label: 'Claim atlas', daysSinceHarvest: null, daysSinceActivity: 0, baselineMedianDays: 6 },
  ],
}

describe('LedgerView render smoke (S2 storyline + S4 foraging)', () => {
  it('renders the storyline strip and the foraging card without crashing', () => {
    const cold = { status: 'cold', view: null, failure: null }
    const html = renderToString(
      <LedgerView
        ledger={cold as ResearchLedgerSlice}
        report={cold as unknown as ResearchReportSlice}
        brief={cold as unknown as ResearchBriefSlice}
        worktree={{ status: 'ready', view: WORKTREE, failure: null } as ResearchWorktreeSlice}
        foraging={{ status: 'ready', view: FORAGING, failure: null } as ResearchForagingSlice}
        selectedProjectId={null}
        loadLedger={() => {}}
        generateReport={() => {}}
        generateBrief={() => {}}
        addJournal={async () => null}
        ensureWorktree={() => {}}
        refreshWorktree={() => {}}
        setMainline={async () => null}
        setIdeaParent={async () => null}
        closeIdea={async () => null}
        ensureForaging={() => {}}
        refreshForaging={() => {}}
        t={t as ResearchT}
      />,
    )

    // Worktree: title, banner, and the storyline SVG with its lane glyphs.
    expect(html).toContain('科研工作树')
    expect(html).toContain('主线')
    expect(html).toContain('<svg')
    expect(html).toContain('●')
    expect(html).toContain('✗')
    // Lifelines + the epoch line + the now-line all present.
    expect(html.match(/<line/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
    // Declared forks render as leaf-vein curves (two children of i1).
    expect(html.match(/worktreeMapFork/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // An adopted lane reaches HTML with its merge glyph.
    expect(html).toContain('已并入（✓）')
    expect(html).toContain('Late-interaction pooling')
    // A dead-end tooltip must format its close date (the audit's crash spot).
    expect(html).toContain('Hybrid sparse-dense routing · 2026-08-17 → 2026-08-27')

    // Foraging: title, the speaking baseline, both territories, the GUT copy.
    expect(html).toContain('领地账本（觅食）')
    expect(html).toContain('中位 6 天')
    expect(html).toContain('四分位距 4 天')
    expect(html).toContain('5 次有据的离开')
    expect(html).toContain('距上次收获 5 天')
    expect(html).toContain('离开间隔中位 6 天')
    expect(html).toContain('Claim atlas')
    expect(html).toContain('尚未开垦')
    expect(html).toContain('两个数字，零动词')
  })
})
