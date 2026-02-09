// PoolStore interface and InMemoryPoolStore implementation

import type {
  SharedLesson,
  ReputationEvent,
  ModerationFlag,
  PurgeToken,
  RegisteredCapability,
  DelegationRequest,
  ShareLessonInput,
  SearchInput,
  SearchResult,
  RegisterCapabilityInput,
  DiscoverInput,
  DelegateInput,
} from './types.js';

export interface PoolStore {
  // Lessons
  shareLesson(input: ShareLessonInput): Promise<SharedLesson>;
  searchLessons(input: SearchInput): Promise<SearchResult[]>;
  getLessonById(id: string): Promise<SharedLesson | null>;
  deleteLessonsByContributor(contributorId: string): Promise<number>;
  countLessonsByContributor(contributorId: string): Promise<number>;
  updateLessonReputation(lessonId: string, score: number): Promise<void>;
  updateLessonFlagCount(lessonId: string, count: number): Promise<void>;
  setLessonHidden(lessonId: string, hidden: boolean): Promise<void>;

  // Reputation
  addReputationEvent(event: Omit<ReputationEvent, 'id'>): Promise<ReputationEvent>;
  getReputationEvents(lessonId: string): Promise<ReputationEvent[]>;

  // Moderation
  addModerationFlag(flag: Omit<ModerationFlag, 'id'>): Promise<ModerationFlag>;
  getModerationFlags(lessonId: string): Promise<ModerationFlag[]>;
  hasAlreadyFlagged(lessonId: string, reporterId: string): Promise<boolean>;

  // Moderation queue
  getModerationQueue(): Promise<SearchResult[]>;

  // Purge tokens
  setPurgeToken(contributorId: string, tokenHash: string): Promise<void>;
  getPurgeToken(contributorId: string): Promise<PurgeToken | null>;

  // Capabilities
  registerCapability(input: RegisterCapabilityInput): Promise<RegisteredCapability>;
  discoverCapabilities(input: DiscoverInput): Promise<RegisteredCapability[]>;
  getCapabilityById(id: string): Promise<RegisteredCapability | null>;
  getCapabilitiesByAgent(agentId: string): Promise<RegisteredCapability[]>;
  unregisterCapability(id: string): Promise<boolean>;

  // Delegation
  createDelegation(input: DelegateInput): Promise<DelegationRequest>;
  getDelegationById(id: string): Promise<DelegationRequest | null>;
  getDelegationInbox(targetAnonymousId: string): Promise<DelegationRequest[]>;
  updateDelegationStatus(
    id: string,
    status: DelegationRequest['status'],
    outputData?: string,
  ): Promise<DelegationRequest | null>;
}

// ---------- Cosine similarity ----------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------- InMemoryPoolStore ----------

let idCounter = 0;
function generateId(): string {
  return `pool-${Date.now()}-${++idCounter}`;
}

export class InMemoryPoolStore implements PoolStore {
  private lessons = new Map<string, SharedLesson>();
  private reputationEvents = new Map<string, ReputationEvent[]>();
  private moderationFlags = new Map<string, ModerationFlag[]>();
  private purgeTokens = new Map<string, PurgeToken>();
  private capabilities = new Map<string, RegisteredCapability>();
  private delegations = new Map<string, DelegationRequest>();

  // ─── Lessons ───

  async shareLesson(input: ShareLessonInput): Promise<SharedLesson> {
    const lesson: SharedLesson = {
      id: generateId(),
      anonymousContributorId: input.anonymousContributorId,
      category: input.category,
      title: input.title,
      content: input.content,
      embedding: input.embedding,
      reputationScore: 50.0,
      flagCount: 0,
      hidden: false,
      createdEpoch: Math.floor(Date.now() / 1000),
      qualitySignals: input.qualitySignals ?? {},
    };
    this.lessons.set(lesson.id, lesson);
    return lesson;
  }

  async searchLessons(input: SearchInput): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const lesson of this.lessons.values()) {
      if (lesson.hidden) continue;
      if (input.category && lesson.category !== input.category) continue;
      if (input.minReputation !== undefined && lesson.reputationScore < input.minReputation) continue;
      const similarity = cosineSimilarity(input.embedding, lesson.embedding);
      results.push({ lesson, similarity });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, input.limit ?? 50);
  }

  async getLessonById(id: string): Promise<SharedLesson | null> {
    return this.lessons.get(id) ?? null;
  }

  async deleteLessonsByContributor(contributorId: string): Promise<number> {
    let count = 0;
    for (const [id, lesson] of this.lessons) {
      if (lesson.anonymousContributorId === contributorId) {
        this.lessons.delete(id);
        this.reputationEvents.delete(id);
        this.moderationFlags.delete(id);
        count++;
      }
    }
    return count;
  }

  async countLessonsByContributor(contributorId: string): Promise<number> {
    let count = 0;
    for (const lesson of this.lessons.values()) {
      if (lesson.anonymousContributorId === contributorId) count++;
    }
    return count;
  }

  async updateLessonReputation(lessonId: string, score: number): Promise<void> {
    const lesson = this.lessons.get(lessonId);
    if (lesson) lesson.reputationScore = score;
  }

  async updateLessonFlagCount(lessonId: string, count: number): Promise<void> {
    const lesson = this.lessons.get(lessonId);
    if (lesson) lesson.flagCount = count;
  }

  async setLessonHidden(lessonId: string, hidden: boolean): Promise<void> {
    const lesson = this.lessons.get(lessonId);
    if (lesson) lesson.hidden = hidden;
  }

  // ─── Reputation ───

  async addReputationEvent(event: Omit<ReputationEvent, 'id'>): Promise<ReputationEvent> {
    const full: ReputationEvent = { ...event, id: generateId() };
    const list = this.reputationEvents.get(event.lessonId) ?? [];
    list.push(full);
    this.reputationEvents.set(event.lessonId, list);
    return full;
  }

  async getReputationEvents(lessonId: string): Promise<ReputationEvent[]> {
    return this.reputationEvents.get(lessonId) ?? [];
  }

  // ─── Moderation ───

  async addModerationFlag(flag: Omit<ModerationFlag, 'id'>): Promise<ModerationFlag> {
    const full: ModerationFlag = { ...flag, id: generateId() };
    const list = this.moderationFlags.get(flag.lessonId) ?? [];
    list.push(full);
    this.moderationFlags.set(flag.lessonId, list);
    return full;
  }

  async getModerationFlags(lessonId: string): Promise<ModerationFlag[]> {
    return this.moderationFlags.get(lessonId) ?? [];
  }

  async hasAlreadyFlagged(lessonId: string, reporterId: string): Promise<boolean> {
    const flags = this.moderationFlags.get(lessonId) ?? [];
    return flags.some((f) => f.reporterAnonymousId === reporterId);
  }

  // ─── Moderation Queue (M3 fix) ───

  async getModerationQueue(): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const lesson of this.lessons.values()) {
      if (lesson.hidden || lesson.flagCount >= 3) {
        results.push({ lesson, similarity: 0 });
      }
    }
    return results;
  }

  // ─── Purge Tokens ───

  async setPurgeToken(contributorId: string, tokenHash: string): Promise<void> {
    this.purgeTokens.set(contributorId, {
      anonymousContributorId: contributorId,
      tokenHash,
      createdEpoch: Math.floor(Date.now() / 1000),
    });
  }

  async getPurgeToken(contributorId: string): Promise<PurgeToken | null> {
    return this.purgeTokens.get(contributorId) ?? null;
  }

  // ─── Capabilities ───

  async registerCapability(input: RegisterCapabilityInput): Promise<RegisteredCapability> {
    const now = Math.floor(Date.now() / 1000);
    const cap: RegisteredCapability = {
      id: generateId(),
      anonymousAgentId: input.anonymousAgentId,
      taskType: input.taskType,
      customType: input.customType,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      qualityMetrics: input.qualityMetrics ?? {},
      trustScorePercentile: input.trustScorePercentile ?? 50.0,
      estimatedLatencyMs: input.estimatedLatencyMs,
      estimatedCostUsd: input.estimatedCostUsd,
      maxInputBytes: input.maxInputBytes,
      scope: input.scope ?? 'public',
      registeredEpoch: now,
      lastSeenEpoch: now,
      active: true,
    };
    this.capabilities.set(cap.id, cap);
    return cap;
  }

  async discoverCapabilities(input: DiscoverInput): Promise<RegisteredCapability[]> {
    const results: RegisteredCapability[] = [];
    for (const cap of this.capabilities.values()) {
      if (!cap.active) continue;
      if (input.taskType && cap.taskType !== input.taskType) continue;
      if (input.customType && cap.customType !== input.customType) continue;
      if (input.minTrust !== undefined && cap.trustScorePercentile < input.minTrust) continue;
      if (input.maxLatencyMs !== undefined && cap.estimatedLatencyMs !== undefined && cap.estimatedLatencyMs > input.maxLatencyMs) continue;
      if (input.maxCostUsd !== undefined && cap.estimatedCostUsd !== undefined && cap.estimatedCostUsd > input.maxCostUsd) continue;
      results.push(cap);
    }
    // Sort by trust score descending
    results.sort((a, b) => b.trustScorePercentile - a.trustScorePercentile);
    return results.slice(0, input.limit ?? 20);
  }

  async getCapabilityById(id: string): Promise<RegisteredCapability | null> {
    return this.capabilities.get(id) ?? null;
  }

  async getCapabilitiesByAgent(agentId: string): Promise<RegisteredCapability[]> {
    const results: RegisteredCapability[] = [];
    for (const cap of this.capabilities.values()) {
      if (cap.anonymousAgentId === agentId) results.push(cap);
    }
    return results;
  }

  async unregisterCapability(id: string): Promise<boolean> {
    const cap = this.capabilities.get(id);
    if (!cap) return false;
    cap.active = false;
    return true;
  }

  // ─── Delegation ───

  async createDelegation(input: DelegateInput): Promise<DelegationRequest> {
    // Idempotency: if delegation with same ID exists, return it
    const existing = this.delegations.get(input.id);
    if (existing) return existing;

    const now = Math.floor(Date.now() / 1000);
    const delegation: DelegationRequest = {
      id: input.id,
      requesterAnonymousId: input.requesterAnonymousId,
      targetAnonymousId: input.targetAnonymousId,
      taskType: input.taskType,
      inputData: input.inputData,
      status: 'pending',
      timeoutEpoch: now + Math.ceil(input.timeoutMs / 1000),
      createdEpoch: now,
    };
    this.delegations.set(delegation.id, delegation);
    return delegation;
  }

  async getDelegationById(id: string): Promise<DelegationRequest | null> {
    return this.delegations.get(id) ?? null;
  }

  async getDelegationInbox(targetAnonymousId: string): Promise<DelegationRequest[]> {
    const results: DelegationRequest[] = [];
    const now = Math.floor(Date.now() / 1000);
    for (const d of this.delegations.values()) {
      if (d.targetAnonymousId === targetAnonymousId && d.status === 'pending') {
        if (d.timeoutEpoch > now) {
          results.push(d);
        }
      }
    }
    return results;
  }

  async updateDelegationStatus(
    id: string,
    status: DelegationRequest['status'],
    outputData?: string,
  ): Promise<DelegationRequest | null> {
    const d = this.delegations.get(id);
    if (!d) return null;
    d.status = status;
    if (outputData !== undefined) d.outputData = outputData;
    if (status === 'completed' || status === 'error' || status === 'rejected') {
      d.completedEpoch = Math.floor(Date.now() / 1000);
    }
    return d;
  }

  // ─── Reset (for testing) ───

  reset(): void {
    this.lessons.clear();
    this.reputationEvents.clear();
    this.moderationFlags.clear();
    this.purgeTokens.clear();
    this.capabilities.clear();
    this.delegations.clear();
  }
}
