/**
 * EvalStore (Feature 15 — Stories 2 & 3)
 *
 * CRUD operations for eval datasets, test cases, runs, and results.
 * All operations are tenant-isolated. Follows BenchmarkStore patterns.
 */

import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet, runInTransaction } from './dialect-db.js';
import type {
  EvalDataset,
  EvalTestCase,
  EvalInput,
  EvalRun,
  EvalRunStatus,
  EvalRunConfig,
  EvalResult,
  ScoreResult,
  ScorerType,
} from '@agentkitai/agentlens-core';

// ─── DB Row Types ──────────────────────────────────────────

interface DatasetRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  version: number;
  parent_id: string | null;
  folder: string | null;
  immutable: number;
  created_at: string;
  updated_at: string;
}

interface TestCaseRow {
  id: string;
  dataset_id: string;
  tenant_id: string;
  input: string;
  expected_output: string | null;
  tags: string;
  metadata: string;
  scoring_criteria: string | null;
  sort_order: number;
  created_at: string;
}

interface RunRow {
  id: string;
  tenant_id: string;
  dataset_id: string;
  dataset_version: number;
  agent_id: string;
  webhook_url: string;
  status: string;
  config: string;
  baseline_run_id: string | null;
  prompt_version_id: string | null;
  model_id: string | null;
  triggered_by: string | null;
  triggered_by_method: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  avg_score: number | null;
  total_cost_usd: number | null;
  total_duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error: string | null;
}

interface ResultRow {
  id: string;
  run_id: string;
  test_case_id: string;
  tenant_id: string;
  session_id: string | null;
  actual_output: string | null;
  score: number;
  passed: number;
  scorer_type: string;
  scorer_details: string;
  latency_ms: number | null;
  cost_usd: number | null;
  token_count: number | null;
  error: string | null;
  created_at: string;
}

// ─── Input Types ───────────────────────────────────────────

export interface CreateDatasetInput {
  name: string;
  description?: string;
  agentId?: string;
  folder?: string;
  testCases?: CreateTestCaseInput[];
}

export interface CreateTestCaseInput {
  input: EvalInput;
  expectedOutput?: unknown;
  tags?: string[];
  metadata?: Record<string, unknown>;
  scoringCriteria?: string;
  sortOrder?: number;
}

export interface ListDatasetFilters {
  agentId?: string;
  folder?: string;
  limit?: number;
  offset?: number;
}

export interface CreateRunInput {
  datasetId: string;
  agentId: string;
  webhookUrl: string;
  config: EvalRunConfig;
  baselineRunId?: string;
  promptVersionId?: string;
  modelId?: string;
  triggeredBy?: string;
  triggeredByMethod?: string;
}

export interface ListRunFilters {
  datasetId?: string;
  agentId?: string;
  status?: EvalRunStatus;
  limit?: number;
  offset?: number;
}

export interface CreateResultInput {
  runId: string;
  testCaseId: string;
  tenantId: string;
  sessionId?: string;
  actualOutput?: unknown;
  score: number;
  passed: boolean;
  scorerType: ScorerType;
  scorerDetails: ScoreResult;
  latencyMs?: number;
  costUsd?: number;
  tokenCount?: number;
  error?: string;
}

/** Parse an events.payload value dialect-safely (text JSON on sqlite, object on pg). */
function parsePayload(p: unknown): Record<string, unknown> {
  if (p == null) return {};
  if (typeof p === 'string') {
    try {
      return JSON.parse(p) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return p as Record<string, unknown>;
}

// ─── Row Converters ────────────────────────────────────────

function rowToDataset(row: DatasetRow): EvalDataset {
  const ds: EvalDataset = {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    version: row.version,
    immutable: row.immutable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.agent_id) ds.agentId = row.agent_id;
  if (row.description) ds.description = row.description;
  if (row.parent_id) ds.parentId = row.parent_id;
  if (row.folder) ds.folder = row.folder;
  return ds;
}

function rowToTestCase(row: TestCaseRow): EvalTestCase {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    tenantId: row.tenant_id,
    input: JSON.parse(row.input) as EvalInput,
    expectedOutput: row.expected_output ? JSON.parse(row.expected_output) : undefined,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    scoringCriteria: row.scoring_criteria ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function rowToRun(row: RunRow): EvalRun {
  const run: EvalRun = {
    id: row.id,
    tenantId: row.tenant_id,
    datasetId: row.dataset_id,
    datasetVersion: row.dataset_version,
    agentId: row.agent_id,
    webhookUrl: row.webhook_url,
    status: row.status as EvalRunStatus,
    config: JSON.parse(row.config) as EvalRunConfig,
    totalCases: row.total_cases,
    passedCases: row.passed_cases,
    failedCases: row.failed_cases,
    createdAt: row.created_at,
  };
  if (row.baseline_run_id) run.baselineRunId = row.baseline_run_id;
  if (row.prompt_version_id) run.promptVersionId = row.prompt_version_id;
  if (row.model_id) run.modelId = row.model_id;
  if (row.triggered_by) run.triggeredBy = row.triggered_by;
  if (row.triggered_by_method) run.triggeredByMethod = row.triggered_by_method;
  if (row.avg_score !== null) run.avgScore = row.avg_score;
  if (row.total_cost_usd !== null) run.totalCostUsd = row.total_cost_usd;
  if (row.total_duration_ms !== null) run.totalDurationMs = row.total_duration_ms;
  if (row.started_at) run.startedAt = row.started_at;
  if (row.completed_at) run.completedAt = row.completed_at;
  return run;
}

function rowToResult(row: ResultRow): EvalResult {
  return {
    id: row.id,
    runId: row.run_id,
    testCaseId: row.test_case_id,
    tenantId: row.tenant_id,
    sessionId: row.session_id ?? undefined,
    actualOutput: row.actual_output ? JSON.parse(row.actual_output) : undefined,
    score: row.score,
    passed: row.passed === 1,
    scorerType: row.scorer_type as ScorerType,
    scorerDetails: JSON.parse(row.scorer_details) as ScoreResult,
    latencyMs: row.latency_ms ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    tokenCount: row.token_count ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
  };
}

// ─── Store Class ───────────────────────────────────────────

export class EvalStore {
  constructor(private readonly db: AnyDb) {}

  // ─── Dataset CRUD ──────────────────────────────────────

  async createDataset(tenantId: string, input: CreateDatasetInput): Promise<EvalDataset> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const queries: SQL[] = [
      sql`
        INSERT INTO eval_datasets (id, tenant_id, agent_id, name, description, folder, version, created_at, updated_at)
        VALUES (${id}, ${tenantId}, ${input.agentId ?? null}, ${input.name}, ${input.description ?? null}, ${input.folder ?? null}, 1, ${now}, ${now})
      `,
    ];
    if (input.testCases && input.testCases.length > 0) {
      for (let i = 0; i < input.testCases.length; i++) {
        const tc = input.testCases[i]!;
        const caseId = randomUUID();
        queries.push(sql`
          INSERT INTO eval_test_cases (id, dataset_id, tenant_id, input, expected_output, tags, metadata, scoring_criteria, sort_order, created_at)
          VALUES (
            ${caseId}, ${id}, ${tenantId},
            ${JSON.stringify(tc.input)},
            ${tc.expectedOutput !== undefined ? JSON.stringify(tc.expectedOutput) : null},
            ${JSON.stringify(tc.tags ?? [])},
            ${JSON.stringify(tc.metadata ?? {})},
            ${tc.scoringCriteria ?? null},
            ${tc.sortOrder ?? i},
            ${now}
          )
        `);
      }
    }
    await runInTransaction(this.db, queries);

    return (await this.getDataset(tenantId, id))!;
  }

  /**
   * Create dataset test cases from a production trace (#214): pair the session's
   * llm_call (request) and llm_response (completion) events by callId, turning each
   * into a test case (prompt + messages context → expected completion, with trace
   * provenance). Adds to an existing dataset (opts.datasetId) or creates a new one.
   */
  async createItemsFromTrace(
    tenantId: string,
    sessionId: string,
    opts: { datasetId?: string; name?: string } = {},
  ): Promise<{ datasetId: string; created: number }> {
    const rows = await dbAll<{ id: string; event_type: string; payload: unknown }>(this.db, sql`
      SELECT id, event_type, payload FROM events
      WHERE tenant_id = ${tenantId} AND session_id = ${sessionId}
        AND event_type IN ('llm_call', 'llm_response')
      ORDER BY timestamp ASC
    `);

    const calls = new Map<string, { eventId: string; payload: Record<string, unknown> }>();
    const responses = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const p = parsePayload(r.payload);
      const callId = String(p.callId ?? '');
      if (!callId) continue;
      if (r.event_type === 'llm_call') calls.set(callId, { eventId: r.id, payload: p });
      else responses.set(callId, p);
    }

    const cases: CreateTestCaseInput[] = [];
    for (const [callId, call] of calls) {
      const resp = responses.get(callId);
      if (!resp) continue;
      const messages = Array.isArray(call.payload.messages)
        ? (call.payload.messages as Array<Record<string, unknown>>)
        : [];
      const lastUser = [...messages].reverse().find((m) => String(m.role) === 'user');
      const prompt = lastUser ? String(lastUser.content ?? '') : JSON.stringify(messages);
      cases.push({
        input: { prompt, context: { messages, model: call.payload.model, systemPrompt: call.payload.systemPrompt } },
        expectedOutput: resp.completion ?? null,
        metadata: { source: 'trace', sessionId, callId, sourceEventId: call.eventId },
      });
    }

    if (opts.datasetId) {
      if (!(await this.getDataset(tenantId, opts.datasetId))) throw new Error('dataset not found');
      if (cases.length > 0) await this.addTestCases(opts.datasetId, tenantId, cases);
      return { datasetId: opts.datasetId, created: cases.length };
    }
    const ds = await this.createDataset(tenantId, { name: opts.name ?? `trace-${sessionId}`, testCases: cases });
    return { datasetId: ds.id, created: cases.length };
  }

  async getDataset(tenantId: string, id: string): Promise<EvalDataset | undefined> {
    const row = await dbGet<DatasetRow>(this.db, sql`
      SELECT * FROM eval_datasets WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!row) return undefined;

    const countRow = await dbGet<{ cnt: number }>(this.db, sql`
      SELECT COUNT(*) as cnt FROM eval_test_cases WHERE dataset_id = ${id}
    `);

    const ds = rowToDataset(row);
    ds.testCaseCount = countRow?.cnt ?? 0;
    return ds;
  }

  async listDatasets(tenantId: string, filters: ListDatasetFilters = {}): Promise<{ datasets: EvalDataset[]; total: number }> {
    const { agentId, folder, limit = 20, offset = 0 } = filters;

    let whereClause = sql`WHERE tenant_id = ${tenantId}`;
    if (agentId) {
      whereClause = sql`${whereClause} AND agent_id = ${agentId}`;
    }
    if (folder !== undefined) {
      whereClause = sql`${whereClause} AND folder = ${folder}`;
    }

    const countRow = await dbGet<{ cnt: number }>(this.db, sql`
      SELECT COUNT(*) as cnt FROM eval_datasets ${whereClause}
    `);
    const total = countRow?.cnt ?? 0;

    const rows = await dbAll<DatasetRow>(this.db, sql`
      SELECT * FROM eval_datasets ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const datasets = await Promise.all(rows.map(async (row) => {
      const ds = rowToDataset(row);
      const countRow2 = await dbGet<{ cnt: number }>(this.db, sql`
        SELECT COUNT(*) as cnt FROM eval_test_cases WHERE dataset_id = ${row.id}
      `);
      ds.testCaseCount = countRow2?.cnt ?? 0;
      return ds;
    }));

    return { datasets, total };
  }

  async updateDataset(tenantId: string, id: string, updates: { name?: string; description?: string; agentId?: string }): Promise<EvalDataset | undefined> {
    const existing = await this.getDataset(tenantId, id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    await dbRun(this.db, sql`
      UPDATE eval_datasets SET
        name = ${updates.name ?? existing.name},
        description = ${updates.description !== undefined ? updates.description : existing.description ?? null},
        agent_id = ${updates.agentId !== undefined ? updates.agentId : existing.agentId ?? null},
        updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);

    return this.getDataset(tenantId, id);
  }

  // ─── Test Case CRUD ────────────────────────────────────

  async getTestCases(datasetId: string): Promise<EvalTestCase[]> {
    const rows = await dbAll<TestCaseRow>(this.db, sql`
      SELECT * FROM eval_test_cases WHERE dataset_id = ${datasetId} ORDER BY sort_order ASC
    `);
    return rows.map(rowToTestCase);
  }

  async addTestCases(datasetId: string, tenantId: string, cases: CreateTestCaseInput[]): Promise<EvalTestCase[]> {
    // Check immutability
    const ds = await dbGet<DatasetRow>(this.db, sql`
      SELECT * FROM eval_datasets WHERE id = ${datasetId} AND tenant_id = ${tenantId}
    `);
    if (!ds) throw new Error(`Dataset ${datasetId} not found`);
    if (ds.immutable === 1) throw new Error('Cannot modify an immutable (versioned) dataset');

    const now = new Date().toISOString();
    const ids: string[] = [];

    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i]!;
      const caseId = randomUUID();
      ids.push(caseId);
      await dbRun(this.db, sql`
        INSERT INTO eval_test_cases (id, dataset_id, tenant_id, input, expected_output, tags, metadata, scoring_criteria, sort_order, created_at)
        VALUES (
          ${caseId}, ${datasetId}, ${tenantId},
          ${JSON.stringify(tc.input)},
          ${tc.expectedOutput !== undefined ? JSON.stringify(tc.expectedOutput) : null},
          ${JSON.stringify(tc.tags ?? [])},
          ${JSON.stringify(tc.metadata ?? {})},
          ${tc.scoringCriteria ?? null},
          ${tc.sortOrder ?? i},
          ${now}
        )
      `);
    }

    // Update dataset's updated_at
    await dbRun(this.db, sql`UPDATE eval_datasets SET updated_at = ${now} WHERE id = ${datasetId}`);

    return Promise.all(ids.map(async id => {
      const row = await dbGet<TestCaseRow>(this.db, sql`SELECT * FROM eval_test_cases WHERE id = ${id}`);
      return rowToTestCase(row!);
    }));
  }

  async updateTestCase(tenantId: string, caseId: string, changes: Partial<CreateTestCaseInput>): Promise<EvalTestCase | undefined> {
    const row = await dbGet<TestCaseRow>(this.db, sql`
      SELECT * FROM eval_test_cases WHERE id = ${caseId} AND tenant_id = ${tenantId}
    `);
    if (!row) return undefined;

    // Check immutability
    const ds = await dbGet<DatasetRow>(this.db, sql`SELECT * FROM eval_datasets WHERE id = ${row.dataset_id}`);
    if (ds && ds.immutable === 1) throw new Error('Cannot modify an immutable (versioned) dataset');

    const now = new Date().toISOString();
    const existing = rowToTestCase(row);

    await dbRun(this.db, sql`
      UPDATE eval_test_cases SET
        input = ${changes.input ? JSON.stringify(changes.input) : row.input},
        expected_output = ${changes.expectedOutput !== undefined ? JSON.stringify(changes.expectedOutput) : row.expected_output},
        tags = ${changes.tags ? JSON.stringify(changes.tags) : row.tags},
        metadata = ${changes.metadata ? JSON.stringify(changes.metadata) : row.metadata},
        scoring_criteria = ${changes.scoringCriteria !== undefined ? changes.scoringCriteria : row.scoring_criteria},
        sort_order = ${changes.sortOrder !== undefined ? changes.sortOrder : row.sort_order}
      WHERE id = ${caseId}
    `);

    // Update dataset's updated_at
    await dbRun(this.db, sql`UPDATE eval_datasets SET updated_at = ${now} WHERE id = ${row.dataset_id}`);

    const updated = await dbGet<TestCaseRow>(this.db, sql`SELECT * FROM eval_test_cases WHERE id = ${caseId}`);
    return updated ? rowToTestCase(updated) : undefined;
  }

  async deleteTestCase(tenantId: string, caseId: string): Promise<boolean> {
    const row = await dbGet<TestCaseRow>(this.db, sql`
      SELECT * FROM eval_test_cases WHERE id = ${caseId} AND tenant_id = ${tenantId}
    `);
    if (!row) return false;

    // Check immutability
    const ds = await dbGet<DatasetRow>(this.db, sql`SELECT * FROM eval_datasets WHERE id = ${row.dataset_id}`);
    if (ds && ds.immutable === 1) throw new Error('Cannot modify an immutable (versioned) dataset');

    await dbRun(this.db, sql`DELETE FROM eval_test_cases WHERE id = ${caseId}`);
    const now = new Date().toISOString();
    await dbRun(this.db, sql`UPDATE eval_datasets SET updated_at = ${now} WHERE id = ${row.dataset_id}`);
    return true;
  }

  // ─── Versioning ────────────────────────────────────────

  async createVersion(tenantId: string, datasetId: string): Promise<EvalDataset> {
    const existing = await this.getDataset(tenantId, datasetId);
    if (!existing) throw new Error(`Dataset ${datasetId} not found`);

    const newId = randomUUID();
    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    const cases = await this.getTestCases(datasetId); // read before the transaction

    const queries: SQL[] = [
      // Mark original as immutable
      sql`
        UPDATE eval_datasets SET immutable = 1, updated_at = ${now}
        WHERE id = ${datasetId} AND tenant_id = ${tenantId}
      `,
      // Create new dataset row
      sql`
        INSERT INTO eval_datasets (id, tenant_id, agent_id, name, description, version, parent_id, created_at, updated_at)
        VALUES (${newId}, ${tenantId}, ${existing.agentId ?? null}, ${existing.name}, ${existing.description ?? null}, ${newVersion}, ${datasetId}, ${now}, ${now})
      `,
    ];
    for (const tc of cases) {
      const caseId = randomUUID();
      queries.push(sql`
        INSERT INTO eval_test_cases (id, dataset_id, tenant_id, input, expected_output, tags, metadata, scoring_criteria, sort_order, created_at)
        VALUES (
          ${caseId}, ${newId}, ${tenantId},
          ${JSON.stringify(tc.input)},
          ${tc.expectedOutput !== undefined ? JSON.stringify(tc.expectedOutput) : null},
          ${JSON.stringify(tc.tags)},
          ${JSON.stringify(tc.metadata)},
          ${tc.scoringCriteria ?? null},
          ${tc.sortOrder},
          ${now}
        )
      `);
    }
    await runInTransaction(this.db, queries);

    return (await this.getDataset(tenantId, newId))!;
  }

  // ─── Run CRUD ──────────────────────────────────────────

  async createRun(tenantId: string, input: CreateRunInput): Promise<EvalRun> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Get dataset version
    const ds = await this.getDataset(tenantId, input.datasetId);
    if (!ds) throw new Error(`Dataset ${input.datasetId} not found`);

    await dbRun(this.db, sql`
      INSERT INTO eval_runs (id, tenant_id, dataset_id, dataset_version, agent_id, webhook_url, status, config, baseline_run_id, prompt_version_id, model_id, triggered_by, triggered_by_method, created_at)
      VALUES (
        ${id}, ${tenantId}, ${input.datasetId}, ${ds.version}, ${input.agentId}, ${input.webhookUrl},
        'pending', ${JSON.stringify(input.config)}, ${input.baselineRunId ?? null},
        ${input.promptVersionId ?? null}, ${input.modelId ?? null}, ${input.triggeredBy ?? null}, ${input.triggeredByMethod ?? null}, ${now}
      )
    `);

    return (await this.getRun(tenantId, id))!;
  }

  async getRun(tenantId: string, id: string): Promise<EvalRun | undefined> {
    const row = await dbGet<RunRow>(this.db, sql`
      SELECT * FROM eval_runs WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!row) return undefined;
    return rowToRun(row);
  }

  async listRuns(tenantId: string, filters: ListRunFilters = {}): Promise<{ runs: EvalRun[]; total: number }> {
    const { datasetId, agentId, status, limit = 20, offset = 0 } = filters;

    let whereClause = sql`WHERE tenant_id = ${tenantId}`;
    if (datasetId) whereClause = sql`${whereClause} AND dataset_id = ${datasetId}`;
    if (agentId) whereClause = sql`${whereClause} AND agent_id = ${agentId}`;
    if (status) whereClause = sql`${whereClause} AND status = ${status}`;

    const countRow = await dbGet<{ cnt: number }>(this.db, sql`
      SELECT COUNT(*) as cnt FROM eval_runs ${whereClause}
    `);
    const total = countRow?.cnt ?? 0;

    const rows = await dbAll<RunRow>(this.db, sql`
      SELECT * FROM eval_runs ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return { runs: rows.map(rowToRun), total };
  }

  async updateRunStatus(id: string, status: EvalRunStatus, aggregates?: Partial<Pick<EvalRun, 'totalCases' | 'passedCases' | 'failedCases' | 'avgScore' | 'totalCostUsd' | 'totalDurationMs' | 'startedAt' | 'completedAt'>>, error?: string): Promise<void> {
    const now = new Date().toISOString();
    await dbRun(this.db, sql`
      UPDATE eval_runs SET
        status = ${status},
        total_cases = COALESCE(${aggregates?.totalCases ?? null}, total_cases),
        passed_cases = COALESCE(${aggregates?.passedCases ?? null}, passed_cases),
        failed_cases = COALESCE(${aggregates?.failedCases ?? null}, failed_cases),
        avg_score = COALESCE(${aggregates?.avgScore ?? null}, avg_score),
        total_cost_usd = COALESCE(${aggregates?.totalCostUsd ?? null}, total_cost_usd),
        total_duration_ms = COALESCE(${aggregates?.totalDurationMs ?? null}, total_duration_ms),
        started_at = COALESCE(${aggregates?.startedAt ?? null}, started_at),
        completed_at = COALESCE(${aggregates?.completedAt ?? null}, completed_at),
        error = COALESCE(${error ?? null}, error)
      WHERE id = ${id}
    `);
  }

  async cancelRun(id: string): Promise<void> {
    await dbRun(this.db, sql`
      UPDATE eval_runs SET status = 'cancelled' WHERE id = ${id} AND status IN ('pending', 'running')
    `);
  }

  // ─── Result CRUD ───────────────────────────────────────

  async saveResult(input: CreateResultInput): Promise<EvalResult> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await dbRun(this.db, sql`
      INSERT INTO eval_results (id, run_id, test_case_id, tenant_id, session_id, actual_output, score, passed, scorer_type, scorer_details, latency_ms, cost_usd, token_count, error, created_at)
      VALUES (
        ${id}, ${input.runId}, ${input.testCaseId}, ${input.tenantId},
        ${input.sessionId ?? null},
        ${input.actualOutput !== undefined ? JSON.stringify(input.actualOutput) : null},
        ${input.score}, ${input.passed ? 1 : 0}, ${input.scorerType},
        ${JSON.stringify(input.scorerDetails)},
        ${input.latencyMs ?? null}, ${input.costUsd ?? null}, ${input.tokenCount ?? null},
        ${input.error ?? null}, ${now}
      )
    `);

    const row = await dbGet<ResultRow>(this.db, sql`SELECT * FROM eval_results WHERE id = ${id}`);
    return rowToResult(row!);
  }

  async getResults(runId: string): Promise<EvalResult[]> {
    const rows = await dbAll<ResultRow>(this.db, sql`
      SELECT * FROM eval_results WHERE run_id = ${runId} ORDER BY created_at ASC
    `);
    return rows.map(rowToResult);
  }

  async getResultForCase(runId: string, testCaseId: string): Promise<EvalResult | undefined> {
    const row = await dbGet<ResultRow>(this.db, sql`
      SELECT * FROM eval_results WHERE run_id = ${runId} AND test_case_id = ${testCaseId}
    `);
    return row ? rowToResult(row) : undefined;
  }
}
