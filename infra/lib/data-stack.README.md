# DataStack

Provisions RDS Postgres (with pgvector), ElastiCache Redis, and application secrets.

## Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.dbInstanceClass` | `string` | RDS instance type (e.g. `db.t4g.micro`) |
| `config.dbMultiAz` | `boolean` | Multi-AZ deployment |
| `config.backupRetention` | `number` | Backup retention in days |
| `config.dbAllocatedStorageGib` | `number` | Initial storage (GB) |
| `config.dbMaxStorageGib` | `number` | Max autoscaled storage (GB) |
| `config.dbMaxConnections` | `number?` | Max DB connections (for alarm threshold) |
| `config.redisNodeType` | `string` | Redis node type |
| `config.redisReplicas` | `number` | Redis replica count (0 = single node) |
| `config.oidcClientSecret` | `string?` | OIDC client secret (optional) |
| `config.deletionProtection` | `boolean` | Enable RDS deletion protection |
| `config.removalPolicy` | `string` | `retain` or `destroy` |
| `network` | `NetworkStack` | VPC and security groups |

## Outputs

| Output | Description |
|--------|-------------|
| `DbEndpoint` | RDS instance endpoint address |
| `DbPort` | RDS instance port |
| `DbSecretArn` | RDS auto-generated credentials secret ARN |
| `DatabaseUrlSecretArn` | Composed `DATABASE_URL` secret ARN |
| `JwtSecretArn` | JWT signing secret ARN |
| `RedisEndpoint` | Redis primary endpoint |
| `RedisUrl` | Full `rediss://` connection URL |

## Resources Created

- RDS Postgres 16 with pgvector (`shared_preload_libraries`)
- ElastiCache Redis 7.1 replication group (TLS enabled)
- Secrets Manager: DATABASE_URL, JWT_SECRET, OIDC_CLIENT_SECRET (optional)
