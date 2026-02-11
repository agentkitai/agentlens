import { request, toQueryString } from './core';

export type LessonImportance = 'low' | 'normal' | 'high' | 'critical';

export interface LessonData {
  id: string;
  tenantId: string;
  agentId?: string;
  category: string;
  title: string;
  content: string;
  context: Record<string, unknown>;
  importance: LessonImportance;
  sourceSessionId?: string;
  sourceEventId?: string;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateLessonData {
  title: string;
  content: string;
  category?: string;
  importance?: LessonImportance;
  agentId?: string;
  context?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceEventId?: string;
}

interface LessonsResponse {
  lessons: LessonData[];
  total: number;
}

export async function getLessons(params?: {
  agentId?: string;
  category?: string;
  importance?: string;
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}): Promise<LessonsResponse> {
  const qs = toQueryString({
    agentId: params?.agentId,
    category: params?.category,
    importance: params?.importance,
    search: params?.search,
    limit: params?.limit,
    offset: params?.offset,
    includeArchived: params?.includeArchived,
  });
  return request<LessonsResponse>(`/api/lessons${qs}`);
}

export async function getLesson(id: string): Promise<LessonData> {
  return request<LessonData>(`/api/lessons/${encodeURIComponent(id)}`);
}

export async function createLesson(data: CreateLessonData): Promise<LessonData> {
  return request<LessonData>('/api/lessons', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLesson(id: string, data: Partial<CreateLessonData>): Promise<LessonData> {
  return request<LessonData>(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteLesson(id: string): Promise<{ id: string; archived: boolean }> {
  return request<{ id: string; archived: boolean }>(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
