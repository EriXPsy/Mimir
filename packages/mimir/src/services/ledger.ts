/**
 * Ledger domain module: the Remote-facing verbs over the append-only growth
 * record — the event query and the progress-report render. The domain logic
 * (event persistence, filtering, report assembly) lives in `../ledger.ts`;
 * this module adds the runtime guards and the `ResearchResult` union shape,
 * matching the other modules under `./services`.
 * @module dsh-mimir/src/services/ledger
 */

import type { ResearchWikiDomain } from '../store.ts'
import {
  appendEvent,
  buildProgressReport,
  JOURNAL_TEXT_MAX_CHARS,
  LIST_EVENTS_MAX_LIMIT,
  listEvents,
  PANEL_ACTOR,
} from '../ledger.ts'
import { deriveBrief, JOURNAL_ACTION, renderBriefMarkdown } from '../cognitive-map.ts'
import type { CbeBriefWindow, CbeWikiSnapshot } from '../cognitive-map.ts'
import type {
  EventRefs,
  LedgerActorKind,
  ResearchAddJournalEntryResult,
  ResearchGenerateBriefOptions,
  ResearchGenerateBriefResult,
  ResearchListEventsResult,
  ResearchProgressReportOptions,
  ResearchProgressReportResult,
} from '../types.ts'
import { rejected, success } from './common.ts'

/** Everything the ledger domain functions need from the service scope. */
export interface LedgerDeps {
  /** Open research-wiki domain (the ledger's events table lives here). */
  readonly domain: ResearchWikiDomain
}

/**
 * Query the research ledger (the append-only growth record). Every field is
 * an optional filter: a project ref, an actor kind, an action prefix
 * (e.g. `compute.`), and ISO-8601 time bounds (`since` inclusive, `until`
 * exclusive). The result is capped (default 200, hard cap 1000) and ordered
 * by (ts, id); `order: 'desc'` inverts it. An illegal limit or an
 * unparseable bound is `invalid-input` — the ledger itself is never mutated
 * by this read.
 * @param deps - open wiki domain.
 * @param request - the optional filters.
 * @returns the matching events.
 */
export async function listEventsRemote(
  deps: LedgerDeps,
  request: {
    projectId?: string | undefined
    actorKind?: string | undefined
    actionPrefix?: string | undefined
    since?: string | undefined
    until?: string | undefined
    limit?: number | undefined
    order?: string | undefined
  },
): Promise<ResearchListEventsResult> {
  const kind = request.actorKind
  if (kind !== undefined && !(['user', 'agent', 'subagent', 'module', 'system'] as readonly string[]).includes(kind)) {
    return rejected({ code: 'invalid-input', message: `unknown actorKind: ${kind}` })
  }
  const order = request.order
  if (order !== undefined && order !== 'asc' && order !== 'desc') {
    return rejected({ code: 'invalid-input', message: `order must be 'asc' or 'desc', got '${order}'` })
  }
  try {
    const events = await listEvents(deps.domain, {
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
      ...(kind === undefined ? {} : { actorKind: kind as LedgerActorKind }),
      ...(request.actionPrefix === undefined ? {} : { actionPrefix: request.actionPrefix }),
      ...(request.since === undefined ? {} : { since: request.since }),
      ...(request.until === undefined ? {} : { until: request.until }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(order === undefined ? {} : { order }),
    })
    return success({ events })
  } catch (error) {
    return rejected({
      code: 'invalid-input',
      message: error instanceof RangeError ? error.message : 'event filter is invalid',
    })
  }
}

/**
 * Render the research PROGRESS report (the transparent growth record) over
 * the ledger plus current wiki state: a TL;DR line, the full progress of the
 * window, the learning & judgment changes (claim transitions, idea failures
 * with reasons, review verdicts), the current state counts, the claim ledger
 * with each claim's last ledgered change, experiments & runs, and the
 * destructive-operations ledger as the closing risk footnote. A project id
 * scopes everything to that project (`project-not-found` for an unknown
 * id); time bounds are ISO-8601 (`since` inclusive, `until` exclusive) — a
 * recent window (e.g. 7 days) produces the weekly 组会 digest. The report is
 * a pure query — it writes nothing.
 * @param deps - open wiki domain.
 * @param request - the optional scope and bounds.
 * @returns the Markdown report plus the event count it covered.
 */
export async function generateProgressReportRemote(
  deps: LedgerDeps,
  request: {
    projectId?: string | undefined
    since?: string | undefined
    until?: string | undefined
  },
): Promise<ResearchProgressReportResult> {
  if (request.projectId !== undefined
    && deps.domain.table('projects').get(request.projectId) === undefined) {
    return rejected({ code: 'project-not-found', projectId: request.projectId })
  }
  const options: ResearchProgressReportOptions = {
    ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    ...(request.since === undefined ? {} : { since: request.since }),
    ...(request.until === undefined ? {} : { until: request.until }),
  }
  try {
    const [markdown, events] = await Promise.all([
      buildProgressReport(deps.domain, options),
      listEvents(deps.domain, {
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        ...(options.since === undefined ? {} : { since: options.since }),
        ...(options.until === undefined ? {} : { until: options.until }),
        limit: LIST_EVENTS_MAX_LIMIT,
      }),
    ])
    return success({ markdown, generatedAt: new Date().toISOString(), eventCount: events.length })
  } catch (error) {
    return rejected({
      code: 'invalid-input',
      message: error instanceof RangeError ? error.message : 'report options are invalid',
    })
  }
}

/**
 * Render the COGNITIVE BRIEF (the DDM-lite roadbook) of one window: the
 * lines' drift states, the eureka candidates, the status transitions, the
 * open loops, the boundary questions — and, between the loops and the
 * questions, the user's own L2 journal lines. Omitted bounds open into the
 * full history (`since` = epoch, `until` = now); an unknown project id is
 * `project-not-found`; an unparseable bound is `invalid-input`. The brief is
 * a pure query — it writes nothing (the L2 write path is
 * {@link addJournalEntryRemote}).
 * @param deps - open wiki domain.
 * @param request - the optional scope and bounds.
 * @returns the Markdown brief plus the event count it covered.
 */
export async function generateBriefRemote(
  deps: LedgerDeps,
  request: {
    projectId?: string | undefined
    since?: string | undefined
    until?: string | undefined
  },
): Promise<ResearchGenerateBriefResult> {
  if (request.projectId !== undefined
    && deps.domain.table('projects').get(request.projectId) === undefined) {
    return rejected({ code: 'project-not-found', projectId: request.projectId })
  }
  const options: ResearchGenerateBriefOptions = {
    ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    ...(request.since === undefined ? {} : { since: request.since }),
    ...(request.until === undefined ? {} : { until: request.until }),
  }
  const window: CbeBriefWindow = {
    since: options.since ?? new Date(0).toISOString(),
    until: options.until ?? new Date().toISOString(),
    projectId: options.projectId ?? null,
  }
  try {
    const events = await listEvents(deps.domain, {
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.since === undefined ? {} : { since: options.since }),
      ...(options.until === undefined ? {} : { until: options.until }),
      limit: LIST_EVENTS_MAX_LIMIT,
    })
    const wiki: CbeWikiSnapshot = {
      ideas: [...deps.domain.table('ideas').entries()].map(([, record]) => record),
      claims: [...deps.domain.table('claims').entries()].map(([, record]) => record),
      projects: [...deps.domain.table('projects').entries()].map(([, record]) => record),
    }
    const brief = deriveBrief(events, wiki, window, Date.now())
    return success({
      markdown: renderBriefMarkdown(brief),
      generatedAt: new Date().toISOString(),
      eventCount: events.length,
    })
  } catch (error) {
    return rejected({
      code: 'invalid-input',
      message: error instanceof RangeError ? error.message : 'brief options are invalid',
    })
  }
}

/**
 * Append one L2 journal entry (the user's own words) to the ledger: the only
 * write path the cognitive map reads as narrative. The text must be a
 * non-blank string capped at {@link JOURNAL_TEXT_MAX_CHARS} characters; a
 * `projectId` scopes the entry (unknown id → `project-not-found`), an
 * `ideaId` writes it against one line — both refs are omitted when absent.
 * The stored event is the single source of truth: L2 is re-derived, never
 * persisted as a table of its own.
 * @param deps - open wiki domain.
 * @param request - the text plus optional project/line refs.
 * @returns the stored journal event.
 */
export async function addJournalEntryRemote(
  deps: LedgerDeps,
  request: {
    text: string
    projectId?: string | undefined
    ideaId?: string | undefined
  },
): Promise<ResearchAddJournalEntryResult> {
  if (typeof request.text !== 'string' || request.text.trim() === '') {
    return rejected({ code: 'invalid-input', message: 'journal text must not be empty' })
  }
  if (request.text.length > JOURNAL_TEXT_MAX_CHARS) {
    return rejected({
      code: 'invalid-input',
      message: `journal text is capped at ${JOURNAL_TEXT_MAX_CHARS} characters`,
    })
  }
  if (request.projectId !== undefined
    && deps.domain.table('projects').get(request.projectId) === undefined) {
    return rejected({ code: 'project-not-found', projectId: request.projectId })
  }
  const refs: EventRefs = {
    ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    ...(request.ideaId === undefined ? {} : { ideaId: request.ideaId }),
  }
  try {
    const event = await appendEvent(deps.domain, {
      actor: PANEL_ACTOR,
      action: JOURNAL_ACTION,
      ...(Object.keys(refs).length === 0 ? {} : { refs }),
      payload: { text: request.text },
    })
    return success({ event })
  } catch (error) {
    return rejected({
      code: 'invalid-input',
      message: error instanceof RangeError ? error.message : 'journal entry is invalid',
    })
  }
}
