# CoffeeBear Environment Model

## Overview

CoffeeBear follows a two-environment model.

It does not use the traditional Dev / Staging / Production three-environment model.

## Test Environment

Purpose:

- Feature verification
- Docker build verification
- Database migration verification
- Release preparation checks

Recommended resources:

- M1 Mac + Docker
- Test Database
- Test Object Storage

Rules:

- No production user data
- Keep close to production behavior
- Not a long-running independent business environment

## Production Environment

Purpose:

- Official business operation

Contains:

- Production Server
- Production Database
- Production Object Storage
- Production secrets

## Rules

- No independent Staging environment
- No long-term three-environment maintenance
- Test validates release readiness
- Production is the only official operating environment

Any change to this model requires a GitHub Issue and maintainer approval.
