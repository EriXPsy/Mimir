/**
 * Render tests for the evidence graph canvas (PRD §69/§70): the claim-head
 * conflict roll-up — dashed ring + chip + accessible name + conflict-pair
 * tooltip lines — against the real `deriveEvidenceGraphLayout` output. The
 * bead-level solid conflict ring must stay distinct. Server-rendered via
 * renderToString, the same harness as the ledger render smoke.
 * @module dsh-client-ui-mimir/tests/evidence-canvas
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import type {
  EvidenceClaimHistory,
  EvidenceConflict,
  EvidenceGraphEdge,
  EvidenceTimelineEntry,
  EvidenceTimelineGroup,
} from 'dsh-mimir/types'
import { deriveEvidenceGraphLayout, type EvidenceGraphLayoutInput } from '../src/client/evidence-graph-layout.ts'
import { conflictLinesByClaim, conflictPairsOfClaim } from '../src/client/evidence-graph-view.ts'
import { DetailPanel } from '../src/client/EvidenceGraphView.tsx'
import { EvidenceGraphCanvas } from '../src/client/EvidenceGraphCanvas.tsx'
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

function entry(partial: Partial<EvidenceTimelineEntry> & { readonly sourceEventId: string; readonly ts: string }): EvidenceTimelineEntry {
  return Object.freeze({ rel: 'supports', actor: { kind: 'panel', id: 'human' }, note: null, retracted: false, ...partial })
}
function claim(partial: Partial<EvidenceClaimHistory> & { readonly claimKey: string; readonly history: readonly EvidenceTimelineEntry[] }): EvidenceClaimHistory {
  return Object.freeze({ claimLabel: partial.claimKey, status: null, supportsCount: 0, contradictsCount: 0, hasConflict: false, ...partial })
}
function group(partial: Partial<EvidenceTimelineGroup> & { readonly key: string; readonly claims: readonly EvidenceClaimHistory[] }): EvidenceTimelineGroup {
  return Object.freeze({ kind: 'idea', label: null, lastActiveAt: '2026-09-06T00:00:00.000Z', ...partial })
}
function edge(partial: Partial<EvidenceGraphEdge> & { readonly id: string; readonly sourceEventId: string }): EvidenceGraphEdge {
  return Object.freeze({
    dedupKey: `dedup:${partial.id}`, rel: 'supports', src: 'lit:arxiv:2401.00001', dst: 'claim:c1',
    ts: '2026-09-01T00:00:00.000Z', actor: { kind: 'panel', id: 'human' }, note: null, retracted: false,
    retractedAt: null, retractedBy: null, retractEventId: null, retractReason: null,
    scope: { projectId: null, ideaId: null, claimId: null }, ...partial,
  })
}
function graph(partial: Partial<EvidenceGraphLayoutInput> & { readonly timeline: readonly EvidenceTimelineGroup[] }): EvidenceGraphLayoutInput {
  return { edges: [], conflicts: [], ...partial }
}

/** The two-claim fixture: one conflicted claim, one clean claim. */
const CONFLICT_EDGES = [
  edge({ id: 'sup', sourceEventId: 'sup', rel: 'supports', src: 'lit:arxiv:2401.00001', dst: 'claim:c1', note: 'clean replication' }),
  edge({ id: 'con', sourceEventId: 'con', rel: 'contradicts', src: 'exp:run:0042', dst: 'claim:c1' }),
]
const CONFLICTS: EvidenceConflict[] = [{
  nodeKey: 'claim:c1',
  supporting: CONFLICT_EDGES[0] as EvidenceGraphEdge,
  contradicting: CONFLICT_EDGES[1] as EvidenceGraphEdge,
}]
const FIXTURE = graph({
  timeline: [group({ key: 'idea:1', claims: [
    claim({ claimKey: 'claim:c1', supportsCount: 1, contradictsCount: 1, hasConflict: true, history: [
      entry({ sourceEventId: 'sup', ts: '2026-09-01T10:00:00.000Z', rel: 'supports' }),
      entry({ sourceEventId: 'con', ts: '2026-09-02T10:00:00.000Z', rel: 'contradicts' }),
    ] }),
    claim({ claimKey: 'claim:c2', hasConflict: false, history: [
      entry({ sourceEventId: 'ok', ts: '2026-09-03T10:00:00.000Z', rel: 'supports' }),
    ] }),
  ] })],
  edges: CONFLICT_EDGES,
  conflicts: CONFLICTS,
})

function renderCanvas(fix: EvidenceGraphLayoutInput = FIXTURE): string {
  const layout = deriveEvidenceGraphLayout(fix)
  const lines = conflictLinesByClaim(fix.conflicts, t as ResearchT)
  return renderToString(
    <EvidenceGraphCanvas
      layout={layout}
      selectedId={null}
      onSelect={() => {}}
      t={t as ResearchT}
      conflictLinesByClaim={lines}
    />,
  )
}

describe('EvidenceGraphCanvas claim-head conflict roll-up', () => {
  it('renders the dashed conflict ring and the chip on a conflicted claim head', () => {
    const html = renderCanvas()
    expect(html).toContain('evidenceClaimConflictRing')
    expect(html).toContain('evidenceConflictChip')
    expect(html).toContain(t('evidence.conflict'))
  })

  it('renders neither ring nor chip on a conflict-free claim head', () => {
    const clean = graph({ timeline: [group({ key: 'idea:1', claims: [
      claim({ claimKey: 'claim:calm', hasConflict: false, history: [
        entry({ sourceEventId: 'e1', ts: '2026-09-01T10:00:00.000Z' }),
      ] }),
    ] })] })
    const html = renderCanvas(clean)
    expect(html).not.toContain('evidenceClaimConflictRing')
    expect(html).not.toContain('evidenceConflictChip')
  })

  it('keeps the bead-level solid conflict ring distinct from the claim ring', () => {
    const html = renderCanvas()
    // Both rings render on the conflicted fixture, under different classes.
    expect(html).toContain('evidenceConflictRing')
    expect(html).toContain('evidenceClaimConflictRing')
    expect(html.match(/evidenceClaimConflictRing/g)?.length ?? 0).toBe(1)
    // The two conflicted beads each carry the solid ring class.
    expect(html.match(/class="[^"]*evidenceConflictRing[^"]*"/g)?.length ?? 0).toBe(2)
  })

  it('speaks the conflict in the accessible label of the claim head', () => {
    const html = renderCanvas()
    expect(html).toContain(`claim:c1 · ${t('evidence.conflict')}`)
    // The clean claim's label carries no conflict suffix.
    expect(html).not.toContain(`claim:c2 · ${t('evidence.conflict')}`)
  })

  it('itemizes both ends of every conflict pair in the claim head title', () => {
    const html = renderCanvas()
    const line = conflictLinesByClaim(CONFLICTS, t as ResearchT).get('claim:c1')?.[0] ?? ''
    expect(line).toBe(`${t('evidence.rel.supports')} · lit:arxiv:2401.00001 ↔ ${t('evidence.rel.contradicts')} · exp:run:0042 · clean replication`)
    expect(html).toContain(`claim:c1 · ${t('evidence.conflict')}\n${line}`)
  })

  it('keeps the ≥28px transparent hit target on every node', () => {
    const html = renderCanvas()
    expect(html.match(/class="[^"]*evidenceNodeHit[^"]*"/g)?.length ?? 0).toBeGreaterThan(0)
    expect(html).toMatch(/evidenceNodeHit[^>]*r="14"/)
  })
})

describe('DetailPanel head selection (conflict pairs)', () => {
  /** Render the real DetailPanel for one laid-out node from the fixture. */
  function renderDetail(claimKey: string): string {
    const layout = deriveEvidenceGraphLayout(FIXTURE)
    const node = layout.nodes.find(item => item.id === `head:${claimKey}`) ?? null
    if (node === null) throw new Error(`no head node for ${claimKey}`)
    const claimHistory = FIXTURE.timeline
      .flatMap(group => group.claims)
      .find(item => item.claimKey === claimKey) ?? null
    const pairs = conflictPairsOfClaim(FIXTURE.conflicts, claimKey)
    const noop = (): void => {}
    return renderToString(
      <DetailPanel
        node={node}
        edge={null}
        claim={claimHistory}
        pairs={pairs}
        onJump={noop}
        onJumpToAudit={noop}
        onConfirm={noop}
        onClose={noop}
        t={t as ResearchT}
      />,
    )
  }

  it('shows the conflict detail with counts, both ends, and the audit jump on a conflicted head', () => {
    const html = renderDetail('claim:c1')
    expect(html).toContain(t('evidence.conflictDetail.title'))
    expect(html).toContain(t('evidence.claim.counts', { supports: 1, contradicts: 1 }))
    expect(html).toContain(t('evidence.conflictDetail.jump'))
    // Both ends of the pair, with their sources and the supporting note.
    expect(html).toContain('lit:arxiv:2401.00001')
    expect(html).toContain('exp:run:0042')
    expect(html).toContain('clean replication')
  })

  it('renders no conflict detail for a clean claim head', () => {
    const html = renderDetail('claim:c2')
    expect(html).not.toContain(t('evidence.conflictDetail.title'))
    expect(html).not.toContain(t('evidence.conflictDetail.jump'))
  })

  it('exposes the structured pairs in fold order for the selected claim', () => {
    const pairs = conflictPairsOfClaim(CONFLICTS, 'claim:c1')
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.ends[0]).toMatchObject({ rel: 'supports', src: 'lit:arxiv:2401.00001', ts: '2026-09-01T00:00:00.000Z' })
    expect(pairs[0]?.ends[1]).toMatchObject({ rel: 'contradicts', src: 'exp:run:0042' })
    expect(conflictPairsOfClaim(CONFLICTS, 'claim:c2')).toEqual([])
  })
})
