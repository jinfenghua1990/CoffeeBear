# CoffeeBear Infrastructure Architecture

## Environment Strategy

CoffeeBear adopts separated Local Development, Test, and Production environments.

Core principles:

- Mac M1 is used for software development, Docker execution, and local debugging only.
- Database and object storage are cloud managed resources.
- Test and Production environments must be completely isolated.
- Configuration is controlled through environment variables.

---

## 1. Local Development Environment

Purpose:

- Daily coding
- Docker development
- Feature debugging
- Function verification

Architecture:

```
Mac M1
  |
 Docker
  |
 CoffeeBear Application
  |
 Cloud Test Resources
```

The local machine does not store production business data.

---

## 2. Test Environment

Purpose:

- New feature validation
- Database migration testing
- Release verification

Architecture:

```
GitHub Test Branch
        |
 CoffeeBear Test
        |
 -------------------------
 |                       |
Supabase Test        Backblaze B2 Test
Database             Storage Bucket
```

Resources:

- Database: `coffeebear-test`
- Storage: `coffeebear-test-storage`

---

## 3. Production Environment

Purpose:

- Daily business operations
- Employee access
- Real business data

Architecture:

```
GitHub Main Branch
        |
 Render Production
        |
 CoffeeBear
        |
 -------------------------
 |                       |
Supabase Production  Backblaze B2 Production
Database             Storage Bucket
```

Resources:

- Database: `coffeebear-prod`
- Storage: `coffeebear-prod-storage`

---

## Infrastructure Selection

| Component | Selection |
|---|---|
| Source Code | GitHub jinfenghua1990/CoffeeBear |
| Local Development | Mac M1 + Docker |
| Production Runtime | Render |
| Database | Supabase PostgreSQL |
| Object Storage | Backblaze B2 |

---

## Environment Isolation Rules

Do not:

- Share Test and Production databases.
- Share Test and Production storage buckets.
- Store production business data on developer machines.
- Use local file storage as a permanent production solution.

This architecture follows the same enterprise environment separation principle used for other platform projects while keeping CoffeeBear infrastructure independent.
