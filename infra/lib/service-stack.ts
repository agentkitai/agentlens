import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/types';
import { NetworkStack } from './network-stack';
import { DataStack } from './data-stack';

export interface ServiceStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  network: NetworkStack;
  data: DataStack;
}

export class ServiceStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const { config, network, data } = props;
    const envName = config.envName;
    const isProd = config.removalPolicy === 'retain';

    // ─── E5-S6: ALB & TLS ───

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: network.vpc,
      internetFacing: true,
      securityGroup: network.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // TLS Certificate
    let certificate: acm.ICertificate;
    if (config.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'Cert', config.certificateArn);
    } else if (config.hostedZoneId && config.hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.hostedZoneName,
      });
      certificate = new acm.Certificate(this, 'Cert', {
        domainName: config.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
      // DNS alias
      new route53.ARecord(this, 'AlbAlias', {
        zone,
        recordName: config.domainName,
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(this.alb)),
      });
    } else {
      // Self-signed / placeholder for dev without Route53
      certificate = new acm.Certificate(this, 'Cert', {
        domainName: config.domainName,
      });
    }

    const httpsListener = this.alb.addListener('Https', {
      port: 443,
      certificates: [certificate],
      protocol: elbv2.ApplicationProtocol.HTTPS,
      open: false,
    });

    // HTTP → HTTPS redirect
    this.alb.addListener('HttpRedirect', {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // ─── E5-S3: ECS Fargate ───

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: network.vpc,
      clusterName: `agentlens-${envName}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // Enable Fargate Spot for non-prod
    if (config.useFargateSpot) {
      cluster.enableFargateCapacityProviders();
    }

    const repository = new ecr.Repository(this, 'Ecr', {
      repositoryName: `agentlens-${envName}`,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: !isProd,
    });

    // Log group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/agentlens-${envName}`,
      retention: config.logRetentionDays as logs.RetentionDays,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Task execution role (for ECR pull, secrets, logs)
    const executionRole = new iam.Role(this, 'TaskExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    data.databaseUrlSecret.grantRead(executionRole);
    data.jwtSecret.grantRead(executionRole);
    data.dbSecret.grantRead(executionRole);
    if (data.oidcSecret) {
      data.oidcSecret.grantRead(executionRole);
    }

    // Task role (minimal — for the running container)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Task definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: config.cpu,
      memoryLimitMiB: config.memoryMiB,
      family: `agentlens-${envName}`,
      executionRole,
      taskRole,
    });

    const container = taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
      environment: {
        NODE_ENV: 'production',
        AUTH_DISABLED: 'false',
        STORAGE_BACKEND: 'postgres',
        DB_SSL: 'true',
        REDIS_URL: cdk.Fn.join('', ['rediss://', data.redisEndpoint, ':', data.redisPort]),
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(data.databaseUrlSecret),
        JWT_SECRET: ecs.Secret.fromSecretsManager(data.jwtSecret),
        ...(data.oidcSecret ? { OIDC_CLIENT_SECRET: ecs.Secret.fromSecretsManager(data.oidcSecret) } : {}),
      },
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
    });

    // Service
    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: config.desiredCount,
      securityGroups: [network.ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      capacityProviderStrategies: config.useFargateSpot
        ? [
            { capacityProvider: 'FARGATE_SPOT', weight: 2 },
            { capacityProvider: 'FARGATE', weight: 1 },
          ]
        : [{ capacityProvider: 'FARGATE', weight: 1 }],
      enableExecuteCommand: true,
    });

    // ALB target group + health check
    const targetGroup = httpsListener.addTargets('EcsTargets', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(5),
      },
      stickinessCookieDuration: undefined, // disabled
    });

    // Auto-scaling
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: config.maxCount,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Migration task definition (same image, override command)
    const migrationExecRole = new iam.Role(this, 'MigrationExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    data.databaseUrlSecret.grantRead(migrationExecRole);

    const migrationTaskDef = new ecs.FargateTaskDefinition(this, 'MigrationTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      family: `agentlens-${envName}-migration`,
      executionRole: migrationExecRole,
    });

    migrationTaskDef.addContainer('migration', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'migration' }),
      command: ['node', 'dist/db/migrate.js'],
      environment: {
        NODE_ENV: 'production',
        DB_SSL: 'true',
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(data.databaseUrlSecret),
      },
    });

    // ─── E5-S8: Monitoring & Alerting ───

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `agentlens-${envName}-alarms`,
      displayName: `AgentLens ${envName} Alarms`,
    });

    if (config.alarmEmail) {
      alarmTopic.addSubscription(new sns_subs.EmailSubscription(config.alarmEmail));
    }

    const alarmAction = new cw_actions.SnsAction(alarmTopic);

    // ECS Alarms
    new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
      metric: this.service.metricCpuUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 85,
      evaluationPeriods: 1,
      alarmDescription: 'ECS CPU > 85%',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, 'EcsMemoryAlarm', {
      metric: this.service.metricMemoryUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 85,
      evaluationPeriods: 1,
      alarmDescription: 'ECS Memory > 85%',
    }).addAlarmAction(alarmAction);

    // ECS Running Count < Desired
    new cloudwatch.Alarm(this, 'EcsRunningCountAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'desired - running',
        usingMetrics: {
          desired: new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'DesiredTaskCount',
            dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: this.service.serviceName },
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
          running: new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'RunningTaskCount',
            dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: this.service.serviceName },
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'ECS running task count < desired',
    }).addAlarmAction(alarmAction);

    // ALB Alarms — 5xx rate >1% (using math expression)
    new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'IF(requests > 0, (errors / requests) * 100, 0)',
        usingMetrics: {
          errors: this.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: cdk.Duration.minutes(3), statistic: 'Sum' }),
          requests: this.alb.metrics.requestCount({ period: cdk.Duration.minutes(3), statistic: 'Sum' }),
        },
        period: cdk.Duration.minutes(3),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'ALB 5xx rate > 1%',
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, 'AlbLatencyAlarm', {
      metric: this.alb.metrics.targetResponseTime({ period: cdk.Duration.minutes(3), statistic: 'p99' }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'ALB p99 latency > 5s',
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, 'UnhealthyTargetsAlarm', {
      metric: targetGroup.metrics.unhealthyHostCount({ period: cdk.Duration.minutes(5) }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Unhealthy targets > 0',
    }).addAlarmAction(alarmAction);

    // RDS Alarms (using metric math from CW namespace)
    const rdsNamespace = 'AWS/RDS';
    const dbId = data.dbInstance.instanceIdentifier;

    new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      metric: new cloudwatch.Metric({
        namespace: rdsNamespace,
        metricName: 'CPUUtilization',
        dimensionsMap: { DBInstanceIdentifier: dbId },
        period: cdk.Duration.minutes(10),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 1,
      alarmDescription: 'RDS CPU > 80%',
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, 'RdsStorageAlarm', {
      metric: new cloudwatch.Metric({
        namespace: rdsNamespace,
        metricName: 'FreeStorageSpace',
        dimensionsMap: { DBInstanceIdentifier: dbId },
        period: cdk.Duration.minutes(10),
        statistic: 'Average',
      }),
      threshold: 5 * 1024 * 1024 * 1024, // 5 GB in bytes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'RDS free storage < 5GB',
    }).addAlarmAction(alarmAction);

    // RDS Connections > 80% of max (t4g.medium max ~150, use 80% = 120; configurable via instance class)
    // Using metric math: connections / max * 100 > 80
    // Max connections varies by instance class; use the DatabaseConnections metric with a reasonable threshold
    new cloudwatch.Alarm(this, 'RdsConnectionsAlarm', {
      metric: new cloudwatch.Metric({
        namespace: rdsNamespace,
        metricName: 'DatabaseConnections',
        dimensionsMap: { DBInstanceIdentifier: dbId },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      // RDS max_connections depends on instance memory. For t4g.micro ~85, t4g.small ~170, t4g.medium ~340
      // We use 80% of a conservative estimate; operators should tune per instance class
      threshold: config.dbMaxConnections ? config.dbMaxConnections * 0.8 : 120,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RDS connections > 80% of max',
    }).addAlarmAction(alarmAction);

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `AgentLens-${envName}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB Requests & Latency',
        left: [this.alb.metrics.requestCount({ period: cdk.Duration.minutes(1) })],
        right: [this.alb.metrics.targetResponseTime({ period: cdk.Duration.minutes(1) })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS CPU & Memory',
        left: [this.service.metricCpuUtilization()],
        right: [this.service.metricMemoryUtilization()],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS Metrics',
        left: [
          new cloudwatch.Metric({ namespace: rdsNamespace, metricName: 'CPUUtilization', dimensionsMap: { DBInstanceIdentifier: dbId } }),
          new cloudwatch.Metric({ namespace: rdsNamespace, metricName: 'DatabaseConnections', dimensionsMap: { DBInstanceIdentifier: dbId } }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Redis Cache',
        left: [
          new cloudwatch.Metric({ namespace: 'AWS/ElastiCache', metricName: 'CacheHitRate', period: cdk.Duration.minutes(5) }),
        ],
        width: 12,
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'AlbHostedZoneId', { value: this.alb.loadBalancerCanonicalHostedZoneId });
    new cdk.CfnOutput(this, 'TargetGroupArn', { value: targetGroup.targetGroupArn });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new cdk.CfnOutput(this, 'EcrRepoUri', { value: repository.repositoryUri });
    new cdk.CfnOutput(this, 'MigrationTaskDefArn', { value: migrationTaskDef.taskDefinitionArn });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn });
  }
}
