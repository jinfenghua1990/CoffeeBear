# CoffeeBear Test / Production Environment Architecture

## Final decision

CoffeeBear uses a **local compute + cloud state** testing model.

The M1 machine is only the Test application runtime. Test database and object storage remain cloud services to keep behavior close to production.

```text
GitHub
  |
  |
Docker Image
  |
+-----------------------------+
|                             |
Test                          Production

M1 Docker                     Cloud Run
(App Runtime)                 (Prod Runtime)

 |                            |
 |                            |
Neon Test                     Neon Prod
R2 Test                       R2 Prod
Redis Test                    Redis Prod
```

## Principles

### 1. Same code, different configuration

Test and Production use the same application code and Docker image.

Environment configuration decides resource connections:

- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_BUCKET`
- storage credentials
- external API secrets

No production/test switching logic should be hard-coded in application code.

## Test environment

M1 provides:

- Docker application runtime
- frontend/API verification
- workflow testing
- developer iteration

M1 does not store important business state.

Test state services:

- Neon Test database
- R2 Test bucket
- Redis Test instance

## Why not local PostgreSQL and MinIO as the main Test environment?

Local database and object storage are useful for offline experiments, but they are not the official Test environment.

Reasons:

- Local PostgreSQL does not fully represent managed PostgreSQL behavior.
- Local filesystem does not represent object storage behavior.
- Presigned URLs, permissions, HTTPS access, and storage policies need real object storage testing.
- Neon branching and cloud database workflows should be validated before production.

## Production environment

Production uses independent resources:

- Cloud Run application runtime
- Neon Production database
- R2 Production bucket
- Production secrets

Test resources must never connect to production resources.

## Release flow

```text
M1 Docker Test
      |
      v
Validation complete
      |
      v
GitHub main
      |
      v
Build/release Docker image
      |
      v
Cloud Run deployment
      |
      v
Inject production configuration
      |
      v
Connect production resources
```

## Data migration rule

Test data does not automatically enter production.

Only explicitly selected business configuration or migration data should be promoted.

Test orders, payments, logs, and temporary files should remain isolated.

## Scope

This architecture applies to CoffeeBear deployment and future environment management decisions.
