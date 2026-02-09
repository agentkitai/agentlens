/**
 * Data Retention & Partition Management (S-8.1, S-8.2)
 */

export {
  type RetentionPolicy,
  type OrgRetentionInfo,
  TIER_RETENTION,
  getEffectiveRetention,
  getRetentionCutoff,
} from './retention-policy.js';

export {
  type RetentionJobResult,
  type RetentionWarning,
  type RetentionError,
  type OrgPurgeResult,
  type RetentionJobDeps,
  type RetentionLogger,
  runRetentionJob,
  purgeExpiredData,
  getExpiringDataSummary,
} from './retention-job.js';

export {
  type PartitionHealthReport,
  type PartitionInfo,
  type PartitionIssue,
  type PartitionManagementResult,
  type PartitionManagementDeps,
  managePartitions,
  getGlobalMinRetentionMonths,
  checkPartitionHealth,
  checkAllPartitionHealth,
} from './partition-management.js';
