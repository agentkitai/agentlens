# AgentLens Infrastructure Runbook

## Scale Up/Down

```bash
# Change desired count in config, then:
npx cdk deploy -c env=prod AgentLens-prod-Service

# Emergency scale via CLI:
aws ecs update-service --cluster agentlens-prod --service <service-name> --desired-count 4
```

Auto-scaling is configured: CPU target 70%, min=desired, max=desired×4.

## DB Migration

```bash
# Run migration task (one-off):
aws ecs run-task \
  --cluster agentlens-prod \
  --task-definition agentlens-prod-migration \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=DISABLED}"
```

Always run migrations BEFORE deploying a new service version.

## Secret Rotation

### RDS Credentials
```bash
# Enable automatic rotation (Lambda-based):
aws secretsmanager rotate-secret \
  --secret-id agentlens/prod/db-credentials \
  --rotation-rules AutomaticallyAfterDays=30
```

### JWT Secret
```bash
# Manual rotation:
aws secretsmanager put-secret-value \
  --secret-id agentlens/prod/jwt-secret \
  --secret-string "$(openssl rand -hex 64)"

# Then restart ECS tasks to pick up new value:
aws ecs update-service --cluster agentlens-prod --service <name> --force-new-deployment
```

## Backup & Restore

### RDS Automated Backups
- Dev: 7-day retention
- Staging: 14-day retention  
- Prod: 35-day retention

### Restore from Snapshot
```bash
# List snapshots:
aws rds describe-db-snapshots --db-instance-identifier <id>

# Restore to new instance:
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier agentlens-prod-restored \
  --db-snapshot-identifier <snapshot-id>
```

## Log Viewing & Debugging

### CloudWatch Logs
```bash
# Tail live logs:
aws logs tail /ecs/agentlens-prod --follow

# Search logs:
aws logs filter-log-events \
  --log-group-name /ecs/agentlens-prod \
  --filter-pattern "ERROR"
```

### ECS Exec (Interactive Shell)
```bash
aws ecs execute-command \
  --cluster agentlens-prod \
  --task <task-id> \
  --container app \
  --interactive \
  --command "/bin/sh"
```

Note: ECS Exec is enabled on the service. Requires the SSM plugin for AWS CLI.

## Environment Teardown

```bash
# Dev/Staging (no deletion protection):
npx cdk destroy -c env=dev --all

# Prod: must disable deletion protection first
# 1. Set deletionProtection: false in config/prod.ts
# 2. Deploy the change
# 3. Then destroy
npx cdk deploy -c env=prod AgentLens-prod-Data
npx cdk destroy -c env=prod --all
```

⚠️ Prod RDS has RETAIN removal policy — manual cleanup of the DB instance required after stack deletion.

## Monitoring

- **Dashboard:** CloudWatch → Dashboards → `AgentLens-{env}`
- **Alarms:** SNS topic `agentlens-{env}-alarms` → email subscriber
- **Alarms configured:**
  - ECS CPU > 85%, Memory > 85%
  - RDS CPU > 80%, Free storage < 5GB
  - ALB 5xx > 10/3min, p99 latency > 5s, unhealthy targets > 0
