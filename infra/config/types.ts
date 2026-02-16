export interface EnvironmentConfig {
  envName: string;
  // Networking
  vpcCidr: string;
  existingVpcId?: string;
  natGateways: number;
  enableFlowLogs: boolean;
  albIngressCidr: string;
  // Database
  dbInstanceClass: string;
  dbMultiAz: boolean;
  backupRetention: number;
  dbMaxStorageGib: number;
  dbAllocatedStorageGib: number;
  // Redis
  redisNodeType: string;
  redisReplicas: number;
  // ECS
  desiredCount: number;
  maxCount: number;
  useFargateSpot: boolean;
  cpu: number;
  memoryMiB: number;
  // ALB / TLS
  domainName: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  certificateArn?: string;
  // Secrets
  oidcClientSecret?: string;
  // Monitoring
  logRetentionDays: number;
  alarmEmail?: string;
  // General
  deletionProtection: boolean;
  removalPolicy: 'destroy' | 'retain';
}
