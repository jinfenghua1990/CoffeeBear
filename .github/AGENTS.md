# CoffeeBear AI Agent Rules

## Source of Truth

GitHub is the Single Source of Truth for CoffeeBear project decisions.

AI Agent, Review Bot and automation tools must not rely only on chat history.

Before making changes, read:

- README.md
- docs/
- Open Issues
- Active Pull Requests

## Decision Rules

The following changes require a documented decision:

- Architecture changes
- Environment changes
- Database model changes
- Deployment strategy changes
- Business rule changes

If uncertain:

1. Create a GitHub Issue.
2. Describe options and impact.
3. Wait for maintainer confirmation.
4. Update docs after decision.

Do not introduce new architecture patterns without approval.

## Work Log Requirements

Important tasks must record:

- What was inspected
- What was changed
- Validation performed
- Problems found
- Remaining risks

## Environment Rule

CoffeeBear uses two environments only:

- Test: M1 + Docker validation environment
- Production: official running environment

Do not introduce Dev/Staging/Production three-environment models unless approved through a GitHub decision record.
