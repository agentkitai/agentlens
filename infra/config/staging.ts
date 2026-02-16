import { EnvironmentConfig } from './types';

export const stagingConfig: EnvironmentConfig = {
  envName: 'staging',
  // Networking
  vpcCidr: '10.1.0.0/16',
  natGateways: 1,
  enableFlowLogs: false,
  albIngressCidr: '0.0.0.0/0',
  // Database
  dbInstanceClass: 'db.t4g.small',
  dbMultiAz: false,
  backupRetention: 14,
  dbAllocatedStorageGib: 20,
  dbMaxStorageGib: 100,
  // Redis
  redisNodeType: 'cache.t4g.micro',
  redisReplicas: 0,
  // ECS
  desiredCount: 1,
  maxCount: 4,
  useFargateSpot: true,
  cpu: 512,
  memoryMiB: 1024,
  // ALB / TLS
  domainName: 'staging.agentlens.example.com',
  // Monitoring
  logRetentionDays: 60,
  // General
  deletionProtection: false,
  removalPolicy: 'destroy',
};
