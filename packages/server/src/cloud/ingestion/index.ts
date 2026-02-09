export {
  type EventQueue,
  type QueuedEvent,
  type QueueHealth,
  type RedisClient,
  type RedisPipeline,
  InMemoryEventQueue,
  RedisEventQueue,
  createEventQueue,
  STREAM_NAME,
  DLQ_STREAM_NAME,
  CONSUMER_GROUP,
  BACKPRESSURE_THRESHOLD,
} from './event-queue.js';

export {
  IngestionGateway,
  validateEvent,
  type IncomingEvent,
  type SingleEventRequest,
  type BatchEventRequest,
  type SingleEventResponse,
  type BatchEventResponse,
  type ValidationError,
} from './gateway.js';

export {
  BatchWriter,
  InMemoryBatchWriter,
  calculateCost,
  computeHash,
  type StreamMessage,
  type BatchWriterConfig,
  type WriterStats,
  type InMemoryBatchWriterDeps,
  type ConsumerRedisClient,
} from './batch-writer.js';

export {
  RedisRateLimiter,
  InMemoryRateLimiter,
  TIER_LIMITS,
  type Tier,
  type RateLimitResult,
  type RateLimitCheckParams,
  type RateLimitConfig,
  type RateLimitRedisClient,
} from './rate-limiter.js';
