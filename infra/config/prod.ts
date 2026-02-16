import { EnvironmentConfig } from './types';

export const prodConfig: EnvironmentConfig = {
  envName: 'prod',
  // Networking
  vpcCidr: '10.2.0.0/16',
  natGateways: 2,
  enableFlowLogs: true,
  albIngressCidr: '0.0.0.0/0',
  // Database
  dbInstanceClass: 'db.t4g.medium',
  dbMultiAz: true,
  backupRetention: 35,
  dbAllocatedStorageGib: 20,
  dbMaxStorageGib: 100,
  // Redis
  redisNodeType: 'cache.t4g.micro',
  redisReplicas: 1,
  // ECS
  desiredCount: 2,
  maxCount: 8,
  useFargateSpot: false,
  cpu: 1024,
  memoryMiB: 2048,
  // ALB / TLS
  domainName: 'agentlens.example.com',
  // Monitoring
  logRetentionDays: 90,
  alarmEmail: 'ops@example.com',
  // General
  deletionProtection: true,
  removalPolicy: 'retain',
};
