// Pool server data model types

export interface SharedLesson {
  id: string;
  anonymousContributorId: string;
  category: string;
  title: string;
  content: string;
  embedding: number[];
  reputationScore: number;
  flagCount: number;
  hidden: boolean;
  createdEpoch: number;
  qualitySignals: Record<string, unknown>;
}

export interface ReputationEvent {
  id: string;
  lessonId: string;
  voterAnonymousId: string;
  delta: number;
  reason: string;
  createdEpoch: number;
}

export interface ModerationFlag {
  id: string;
  lessonId: string;
  reporterAnonymousId: string;
  reason: 'spam' | 'harmful' | 'low_quality' | 'sensitive_data';
  createdEpoch: number;
}

export interface PurgeToken {
  anonymousContributorId: string;
  tokenHash: string;
  createdEpoch: number;
}

export interface RegisteredCapability {
  id: string;
  anonymousAgentId: string;
  taskType: string;
  customType?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  qualityMetrics: Record<string, unknown>;
  trustScorePercentile: number;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope: 'internal' | 'public';
  registeredEpoch: number;
  lastSeenEpoch: number;
  active: boolean;
}

export interface DelegationRequest {
  id: string;
  requesterAnonymousId: string;
  targetAnonymousId: string;
  taskType: string;
  inputData: string; // JSON string (would be encrypted in production)
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'timeout' | 'error';
  outputData?: string;
  timeoutEpoch: number;
  createdEpoch: number;
  completedEpoch?: number;
}

export interface ShareLessonInput {
  anonymousContributorId: string;
  category: string;
  title: string;
  content: string;
  embedding: number[];
  qualitySignals?: Record<string, unknown>;
}

export interface SearchInput {
  embedding: number[];
  category?: string;
  minReputation?: number;
  limit?: number;
}

export interface SearchResult {
  lesson: SharedLesson;
  similarity: number;
}

export interface RegisterCapabilityInput {
  anonymousAgentId: string;
  taskType: string;
  customType?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  qualityMetrics?: Record<string, unknown>;
  trustScorePercentile?: number;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope?: 'internal' | 'public';
}

export interface DiscoverInput {
  taskType?: string;
  customType?: string;
  minTrust?: number;
  maxLatencyMs?: number;
  maxCostUsd?: number;
  limit?: number;
}

export interface DelegateInput {
  id: string;
  requesterAnonymousId: string;
  targetAnonymousId: string;
  taskType: string;
  inputData: string;
  timeoutMs: number;
}
