import { EnvironmentConfig } from './types';

export const devConfig: EnvironmentConfig = {
  envName: 'dev',
  // Networking
  vpcCidr: '10.0.0.0/16',
  natGateways: 1,
  enableFlowLogs: false,
  albIngressCidr: '0.0.0.0/0',
  // Database
  dbInstanceClass: 'db.t4g.micro',
  dbMultiAz: false,
  backupRetention: 7,
  dbAllocatedStorageGib: 20,
  dbMaxStorageGib: 100,
  // Redis
  redisNodeType: 'cache.t4g.micro',
  redisReplicas: 0,
  // ECS
  desiredCount: 1,
  maxCount: 4,
  useFargateSpot: true,
  cpu: 256,
  memoryMiB: 512,
  // ALB / TLS
  domainName: 'dev.agentlens.example.com',
  // Monitoring
  logRetentionDays: 30,
  // General
  deletionProtection: false,
  removalPolicy: 'destroy',
};
