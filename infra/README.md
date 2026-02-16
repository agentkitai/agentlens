# AgentLens Infrastructure (AWS CDK)

Production-ready AWS infrastructure for AgentLens using CDK (TypeScript).

## Architecture

```
                    ┌─────────────┐
                    │  Route 53   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
          ┌────────│     ALB      │────────┐
          │        │  (HTTPS/443) │        │
          │        └──────────────┘        │
          │         Public Subnets         │
──────────┼────────────────────────────────┼──────
          │        Private Subnets         │
   ┌──────▼──────┐                  ┌──────▼──────┐
   │ ECS Fargate │                  │ ECS Fargate │
   │   Task 1    │                  │   Task 2    │
   └──┬─────┬────┘                  └──┬─────┬────┘
      │     │                          │     │
      │     └──────────┬───────────────┘     │
      │         ┌──────▼──────┐              │
      │         │   Redis     │              │
      │         │ ElastiCache │              │
      │         └─────────────┘              │
      │                                      │
      └──────────────┬───────────────────────┘
              ┌──────▼──────┐
              │  RDS Postgres│
              │  (pgvector)  │
              └──────────────┘
```

## Prerequisites

- Node.js 18+
- AWS CLI v2 configured with credentials
- AWS CDK CLI: `npm install -g aws-cdk`
- An AWS account bootstrapped: `cdk bootstrap aws://ACCOUNT/REGION`
- (Optional) Route 53 hosted zone for DNS validation

## Quick Start (Dev)

```bash
cd infra
npm install
npx cdk synth -c env=dev
npx cdk deploy -c env=dev --all --require-approval never
```

## Stacks

| Stack | Description |
|-------|-------------|
| `AgentLens-{env}-Network` | VPC, subnets, NAT, security groups |
| `AgentLens-{env}-Data` | RDS Postgres, ElastiCache Redis, Secrets Manager |
| `AgentLens-{env}-Service` | ALB, ECS Fargate, monitoring, dashboards |

## Configuration

All environment configs in `config/`:

| Parameter | Dev | Staging | Prod |
|-----------|-----|---------|------|
| NAT Gateways | 1 | 1 | 2 (HA) |
| DB Instance | db.t4g.micro | db.t4g.small | db.t4g.medium |
| DB Multi-AZ | No | No | Yes |
| Backup Retention | 7 days | 14 days | 35 days |
| ECS Tasks | 1 | 1 | 2+ |
| Fargate Spot | Yes | Yes | No |
| Flow Logs | No | No | Yes |
| Log Retention | 30 days | 60 days | 90 days |
| Deletion Protection | No | No | Yes |

### Custom Domain / TLS

Set in config:
- `domainName`: FQDN for the ALB
- `hostedZoneId` + `hostedZoneName`: Route 53 zone for ACM DNS validation
- `certificateArn`: Use an existing ACM certificate instead

### BYO VPC

Set `existingVpcId` in config to skip VPC creation.

## Cost Estimates

| Environment | Monthly Estimate |
|-------------|-----------------|
| Dev | ~$70-90 |
| Staging | ~$100-150 |
| Prod | ~$240-400 |

Major cost drivers: NAT Gateway (~$33/ea), RDS instance, ECS Fargate tasks.

## Deploying

```bash
# Dev
npx cdk deploy -c env=dev --all

# Staging
npx cdk deploy -c env=staging --all

# Prod (requires approval)
npx cdk deploy -c env=prod --all
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cdk bootstrap` fails | Ensure AWS credentials are configured for the target account |
| ACM cert stuck pending | Check Route 53 has the CNAME validation record |
| ECS tasks crash-looping | Check CloudWatch logs: `/ecs/agentlens-{env}` |
| RDS connection timeout | Verify ECS SG → RDS SG rule, check VPC subnets |
| Redis TLS errors | App must use `rediss://` (double-s) protocol |
