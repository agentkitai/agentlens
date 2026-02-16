import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/types';
import { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  network: NetworkStack;
}

export class DataStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly databaseUrlSecret: secretsmanager.Secret;
  public readonly jwtSecret: secretsmanager.Secret;
  public readonly oidcSecret?: secretsmanager.Secret;
  public readonly redisEndpoint: string;
  public readonly redisPort: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, network } = props;
    const isProd = config.removalPolicy === 'retain';
    const removal = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // ─── E5-S4: RDS Postgres with pgvector ───

    const parameterGroup = new rds.ParameterGroup(this, 'PgParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      description: `AgentLens ${config.envName} - pgvector`,
      parameters: {
        'shared_preload_libraries': 'vector',
      },
    });

    this.dbInstance = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(config.dbInstanceClass.replace('db.', '')),
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [network.rdsSecurityGroup],
      parameterGroup,
      databaseName: 'agentlens',
      credentials: rds.Credentials.fromGeneratedSecret('agentlens', {
        secretName: `agentlens/${config.envName}/db-credentials`,
      }),
      multiAz: config.dbMultiAz,
      allocatedStorage: config.dbAllocatedStorageGib,
      maxAllocatedStorage: config.dbMaxStorageGib,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(config.backupRetention),
      deletionProtection: config.deletionProtection,
      removalPolicy: removal,
      autoMinorVersionUpgrade: true,
    });

    this.dbSecret = this.dbInstance.secret!;

    // DATABASE_URL composed secret
    this.databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrl', {
      secretName: `agentlens/${config.envName}/database-url`,
      removalPolicy: removal,
      // Value will be constructed from RDS outputs at deploy time
      // Using a dynamic reference pattern
      secretStringValue: cdk.SecretValue.unsafePlainText(
        cdk.Fn.join('', [
          'postgresql://agentlens:',
          cdk.Fn.join('', [
            '{{resolve:secretsmanager:',
            this.dbSecret.secretName,
            ':SecretString:password}}',
          ]),
          '@',
          this.dbInstance.dbInstanceEndpointAddress,
          ':',
          this.dbInstance.dbInstanceEndpointPort,
          '/agentlens?sslmode=require',
        ]),
      ),
    });

    // ─── E5-S7: Secrets Management ───

    this.jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `agentlens/${config.envName}/jwt-secret`,
      description: 'JWT signing secret',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: removal,
    });

    if (config.oidcClientSecret) {
      this.oidcSecret = new secretsmanager.Secret(this, 'OidcSecret', {
        secretName: `agentlens/${config.envName}/oidc-client-secret`,
        description: 'OIDC client secret',
        removalPolicy: removal,
        secretStringValue: cdk.SecretValue.unsafePlainText(config.oidcClientSecret),
      });
    }

    // ─── E5-S5: ElastiCache Redis ───

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: `AgentLens ${config.envName} Redis subnet group`,
      subnetIds: network.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      cacheSubnetGroupName: `agentlens-${config.envName}-redis`,
    });

    const redisReplicationGroup = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: `AgentLens ${config.envName} Redis`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: config.redisNodeType,
      numCacheClusters: config.redisReplicas + 1, // primary + replicas
      automaticFailoverEnabled: config.redisReplicas > 0,
      multiAzEnabled: config.redisReplicas > 0,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
      securityGroupIds: [network.redisSecurityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      port: 6379,
    });
    redisReplicationGroup.addDependency(redisSubnetGroup);

    this.redisEndpoint = redisReplicationGroup.attrPrimaryEndPointAddress;
    this.redisPort = redisReplicationGroup.attrPrimaryEndPointPort;

    // Outputs
    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.dbInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DbPort', { value: this.dbInstance.dbInstanceEndpointPort });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
    new cdk.CfnOutput(this, 'DatabaseUrlSecretArn', { value: this.databaseUrlSecret.secretArn });
    new cdk.CfnOutput(this, 'JwtSecretArn', { value: this.jwtSecret.secretArn });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: this.redisEndpoint });
    new cdk.CfnOutput(this, 'RedisUrl', {
      value: cdk.Fn.join('', ['rediss://', this.redisEndpoint, ':', this.redisPort]),
    });
  }
}
