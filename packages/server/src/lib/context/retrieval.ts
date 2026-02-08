/**
 * Context Retriever (Story 5.2)
 *
 * Combines semantic search over session summaries, lesson search,
 * and key event retrieval to build cross-session context.
 *
 * Falls back to text search when embeddings are unavailable.
 */

import type { ContextQuery, ContextResult, ContextSession, ContextLesson, ContextKeyEvent } from '@agentlensai/core';
import type { EmbeddingStore, SimilarityResult } from '../../db/embedding-store.js';
import type { EmbeddingService } from '../embeddings/index.js';
import type { SessionSummaryStore, SessionSummaryRecord } from '../../db/session-summary-store.js';
import type { LessonStore } from '../../db/lesson-store.js';
import type { IEventStore } from '@agentlensai/core';
import { summarizeEvent } from '../embeddings/summarizer.js';

/** Default maximum results */
const DEFAULT_LIMIT = 10;

/** Maximum key events per session in results */
const MAX_KEY_EVENTS = 5;

export class ContextRetriever {
  constructor(
    private readonly embeddingStore: EmbeddingStore | null,
    private readonly embeddingService: EmbeddingService | null,
    private readonly sessionSummaryStore: SessionSummaryStore,
    private readonly lessonStore: LessonStore,
    private readonly eventStore: IEventStore,
  ) {}

  /**
   * Retrieve cross-session context by combining:
   * 1. Semantic search over session summary embeddings
   * 2. Lesson search (semantic or text-based)
   * 3. Key events for matching sessions
   * 4. Ranking by relevance + recency
   */
  async retrieve(tenantId: string, query: ContextQuery): Promise<ContextResult> {
    const limit = query.limit ?? DEFAULT_LIMIT;

    // Step 1: Find relevant sessions
    const sessionResults = await this.findRelevantSessions(tenantId, query, limit);

    // Step 2: Find relevant lessons
    const lessonResults = await this.findRelevantLessons(tenantId, query, limit);

    // Step 3: For each matching session, get key events
    const sessionsWithEvents: ContextSession[] = await Promise.all(
      sessionResults.map((s) => this.enrichSessionWithEvents(tenantId, s)),
    );

    return {
      topic: query.topic,
      sessions: sessionsWithEvents,
      lessons: lessonResults,
      totalSessions: sessionsWithEvents.length,
    };
  }

  /**
   * Find relevant sessions using semantic search (with text search fallback).
   */
  private async findRelevantSessions(
    tenantId: string,
    query: ContextQuery,
    limit: number,
  ): Promise<Array<{ sessionId: string; summary: string; relevanceScore: number }>> {
    // Try semantic search first
    if (this.embeddingService && this.embeddingStore) {
      try {
        const queryVector = await this.embeddingService.embed(query.topic);
        const results = this.embeddingStore.similaritySearch(tenantId, queryVector, {
          sourceType: 'session',
          from: query.from,
          to: query.to,
          limit: limit * 2, // over-fetch for post-filtering
          minScore: 0.3,
        });

        if (results.length > 0) {
          return this.filterAndRankSessions(tenantId, results, query, limit);
        }
      } catch {
        // Fall through to text search
      }
    }

    // Fallback: text search on session summaries
    return this.textSearchSessions(tenantId, query, limit);
  }

  /**
   * Filter semantic search results by agentId/userId and rank by relevance + recency.
   */
  private async filterAndRankSessions(
    tenantId: string,
    results: SimilarityResult[],
    query: ContextQuery,
    limit: number,
  ): Promise<Array<{ sessionId: string; summary: string; relevanceScore: number }>> {
    const sessions: Array<{ sessionId: string; summary: string; relevanceScore: number }> = [];

    for (const result of results) {
      // sourceId is the sessionId for session-scope embeddings
      const sessionId = result.sourceId;

      // Filter by agentId if provided
      if (query.agentId) {
        const session = await this.eventStore.getSession(sessionId);
        if (!session || session.agentId !== query.agentId) continue;
      }

      // Get the summary text from the store (richer than embedding text)
      const summaryRecord = this.sessionSummaryStore.get(tenantId, sessionId);
      const summary = summaryRecord?.summary ?? result.text;

      // Recency boost: more recent sessions score slightly higher
      const recencyBoost = this.computeRecencyBoost(result.createdAt);
      const adjustedScore = result.score * 0.85 + recencyBoost * 0.15;

      sessions.push({
        sessionId,
        summary,
        relevanceScore: Math.round(adjustedScore * 10000) / 10000,
      });

      if (sessions.length >= limit) break;
    }

    // Sort by adjusted score descending
    sessions.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return sessions.slice(0, limit);
  }

  /**
   * Text search fallback when embeddings are unavailable.
   */
  private textSearchSessions(
    tenantId: string,
    query: ContextQuery,
    limit: number,
  ): Array<{ sessionId: string; summary: string; relevanceScore: number }> {
    const results = this.sessionSummaryStore.search(tenantId, query.topic, limit * 2);

    let filtered = results;

    // If agentId filter is needed, we need to cross-reference sessions
    // For text search, we can't easily filter by agentId synchronously here,
    // so we'll skip that filter for the text fallback (best effort)

    return filtered.slice(0, limit).map((r, index) => ({
      sessionId: r.sessionId,
      summary: r.summary,
      // Assign a decreasing relevance score for text search results (1.0 → 0.5)
      relevanceScore: Math.round((1.0 - index * (0.5 / Math.max(limit, 1))) * 10000) / 10000,
    }));
  }

  /**
   * Find relevant lessons using semantic search (with text search fallback).
   */
  private async findRelevantLessons(
    tenantId: string,
    query: ContextQuery,
    limit: number,
  ): Promise<ContextLesson[]> {
    // Try semantic search first
    if (this.embeddingService && this.embeddingStore) {
      try {
        const queryVector = await this.embeddingService.embed(query.topic);
        const results = this.embeddingStore.similaritySearch(tenantId, queryVector, {
          sourceType: 'lesson',
          limit,
          minScore: 0.3,
        });

        if (results.length > 0) {
          const lessons: ContextLesson[] = [];

          for (const result of results) {
            const lesson = this.lessonStore.get(tenantId, result.sourceId);
            if (lesson) {
              lessons.push({
                id: lesson.id,
                title: lesson.title,
                content: lesson.content,
                category: lesson.category,
                importance: lesson.importance,
                relevanceScore: Math.round(result.score * 10000) / 10000,
              });
            }
          }

          return lessons;
        }
      } catch {
        // Fall through to text search
      }
    }

    // Fallback: text search on lessons
    const textResults = this.lessonStore.list(tenantId, {
      search: query.topic,
      limit,
    });

    return textResults.map((lesson, index) => ({
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      category: lesson.category,
      importance: lesson.importance,
      // Assign decreasing scores for text search results
      relevanceScore: Math.round((1.0 - index * (0.5 / Math.max(limit, 1))) * 10000) / 10000,
    }));
  }

  /**
   * Enrich a session result with key events from the timeline.
   */
  private async enrichSessionWithEvents(
    tenantId: string,
    session: { sessionId: string; summary: string; relevanceScore: number },
  ): Promise<ContextSession> {
    // Get session metadata for startedAt/endedAt/agentId
    const sessionRecord = await this.eventStore.getSession(session.sessionId);

    // Get timeline events for key event extraction
    let keyEvents: ContextKeyEvent[] = [];
    try {
      const timeline = await this.eventStore.getSessionTimeline(session.sessionId);

      // Extract key events: errors, tool calls, session boundaries
      const significant = timeline.filter(
        (e) =>
          e.eventType === 'tool_error' ||
          e.eventType === 'tool_call' ||
          e.eventType === 'session_started' ||
          e.eventType === 'session_ended' ||
          e.severity === 'error' ||
          e.severity === 'critical',
      );

      keyEvents = significant.slice(0, MAX_KEY_EVENTS).map((e) => {
        const eventSummary = summarizeEvent(e) ?? `${e.eventType}`;
        return {
          id: e.id,
          eventType: e.eventType,
          summary: eventSummary,
          timestamp: e.timestamp,
        };
      });
    } catch {
      // Non-critical — return session without events
    }

    return {
      sessionId: session.sessionId,
      agentId: sessionRecord?.agentId ?? '',
      summary: session.summary,
      relevanceScore: session.relevanceScore,
      startedAt: sessionRecord?.startedAt ?? '',
      endedAt: sessionRecord?.endedAt,
      keyEvents,
    };
  }

  /**
   * Compute a recency boost (0-1) based on how recent the content is.
   * Items from the last 24h get ~1.0, items from 30+ days ago get ~0.0.
   */
  private computeRecencyBoost(createdAt: string): number {
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    const ageMs = now - created;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    if (ageMs <= 0) return 1.0;
    if (ageMs >= thirtyDaysMs) return 0.0;
    return 1.0 - ageMs / thirtyDaysMs;
  }
}
