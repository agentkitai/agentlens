# ServiceStack

Deploys the ALB, ECS Fargate service, monitoring alarms, and CloudWatch dashboard.

## Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.domainName` | `string` | Domain name for ACM certificate |
| `config.certificateArn` | `string?` | Existing ACM certificate ARN |
| `config.hostedZoneId` | `string?` | Route 53 hosted zone ID (for CDK-managed cert) |
| `config.hostedZoneName` | `string?` | Route 53 zone name |
| `config.desiredCount` | `number` | ECS desired task count |
| `config.maxCount` | `number` | ECS max task count (autoscaling) |
| `config.useFargateSpot` | `boolean` | Use Fargate Spot capacity |
| `config.cpu` | `number` | Task CPU units |
| `config.memoryMiB` | `number` | Task memory (MiB) |
| `config.logRetentionDays` | `number` | CloudWatch log retention |
| `config.alarmEmail` | `string?` | Email for alarm notifications |
| `network` | `NetworkStack` | VPC and security groups |
| `data` | `DataStack` | Database, Redis, and secrets |

## Outputs

| Output | Description |
|--------|-------------|
| `AlbDnsName` | ALB DNS name |
| `AlbHostedZoneId` | ALB canonical hosted zone ID |
| `TargetGroupArn` | ALB target group ARN |
| `ClusterName` | ECS cluster name |
| `ServiceName` | ECS service name |
| `EcrRepoUri` | ECR repository URI |
| `MigrationTaskDefArn` | Migration task definition ARN |
| `AlarmTopicArn` | SNS alarm topic ARN |

## Resources Created

- ALB with HTTPS (ACM cert) + HTTP→HTTPS redirect
- ECS Fargate cluster & service with autoscaling (CPU 70%)
- ECR repository
- Migration task definition (`node dist/db/migrate.js`)
- CloudWatch Alarms: ECS CPU/Memory/RunningCount, RDS CPU/Storage/Connections, ALB 5xx rate/latency/unhealthy targets
- SNS alarm topic
- CloudWatch Dashboard: ALB, ECS, RDS, Redis metrics
