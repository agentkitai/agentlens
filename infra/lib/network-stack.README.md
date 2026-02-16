# NetworkStack

Creates the VPC, subnets, and security groups for the AgentLens environment.

## Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.vpcCidr` | `string` | VPC CIDR block (default `10.0.0.0/16`) |
| `config.existingVpcId` | `string?` | Use existing VPC instead of creating one |
| `config.natGateways` | `number` | Number of NAT Gateways (1 for dev, 2 for prod HA) |
| `config.enableFlowLogs` | `boolean` | Enable VPC Flow Logs to CloudWatch |
| `config.albIngressCidr` | `string` | CIDR allowed to reach ALB (default `0.0.0.0/0`) |

## Outputs

| Output | Description |
|--------|-------------|
| `VpcId` | VPC ID |
| `AlbSgId` | ALB security group ID (443/80 inbound) |
| `EcsSgId` | ECS security group ID (3000 from ALB only) |
| `RdsSgId` | RDS security group ID (5432 from ECS only) |
| `RedisSgId` | Redis security group ID (6379 from ECS only) |

## Resources Created

- VPC with 2 public + 2 private subnets across 2 AZs (or BYO VPC)
- NAT Gateway(s) for private subnet egress
- VPC Flow Logs (conditional)
- 4 security groups: ALB, ECS, RDS, Redis — scoped least-privilege
