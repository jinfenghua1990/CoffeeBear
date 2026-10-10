# CoffeeBear Decision Log

CoffeeBear uses this file as a durable record of accepted project decisions. GitHub Issues and Pull Requests contain the discussion and implementation history; this file records the decisions that future AI Agents, Review Bots, automation tools, and developers must treat as current project policy.

## Reading rule

Before changing architecture, environment strategy, data ownership, deployment strategy, or core business rules, agents must:

1. Read `README.md`.
2. Read `.github/AGENTS.md`.
3. Read this decision log and other relevant docs.
4. Check related open Issues and active Pull Requests.
5. If a required decision is unclear or conflicts with existing policy, create or update a GitHub Issue and obtain maintainer confirmation before changing the policy.

Accepted decisions must not be silently replaced by chat-only conclusions.

---

## DEC-001 — Two-environment model only

**Status:** Accepted  
**Source:** GitHub Issue #16 — `docs: establish two-environment model (Test + Production)`

### Decision

CoffeeBear uses exactly two operational environments:

- **Test** — development, functional verification, Docker validation, database migration verification, and release-readiness checks.
- **Production** — the only official business-running environment.

CoffeeBear does **not** maintain a separate long-running Staging environment and does **not** use a Dev / Staging / Production three-environment model.

### Current intended shape

- Test compute: M1 Mac + Docker.
- Test data resources: dedicated non-production database and object-storage resources where applicable.
- Production: official server/runtime plus production database, production object storage, and production secrets.

### Guardrail

Any proposal to add another persistent environment requires a GitHub Issue, impact analysis, and explicit maintainer approval before implementation.

---

## DEC-002 — GitHub is the project source of truth for AI-agent work

**Status:** Accepted  
**Source:** GitHub Issue #17 — `docs: establish AI Agent operation log and decision record rules`

### Decision

GitHub is CoffeeBear's Single Source of Truth for project decisions and important implementation history. Chat history alone is not sufficient project memory.

All AI Agents, Review Bots, development robots, and automation tools performing important work must leave a trace in GitHub through the appropriate combination of:

- Issue
- Pull Request
- Commit message
- Documentation update

### Required work record

Important work must record, as applicable:

- what was inspected;
- what was changed;
- why it was changed;
- validation performed and results;
- problems discovered;
- unresolved questions or remaining risks.

### Uncertain-decision rule

Agents must not independently invent or replace policy when uncertain about:

- architecture;
- data ownership or data model;
- environment strategy;
- deployment strategy;
- core business rules.

The required flow is:

1. Create or update a GitHub Issue.
2. Describe the question, options, and impact.
3. Obtain maintainer confirmation.
4. Implement the confirmed decision.
5. Update durable documentation and the work record.

---

## Relationship to other governance files

- `README.md` — project entry point and high-level rules.
- `.github/AGENTS.md` — mandatory AI-agent operating rules.
- `docs/AGENT_WORKFLOW.md` — execution and work-log workflow.
- `docs/ENVIRONMENT.md` — detailed environment policy.
- `docs/DECISIONS.md` — accepted durable project decisions (this file).

When these sources appear inconsistent, agents must not guess. Open or update a GitHub Issue and ask the maintainer to resolve the conflict before changing architecture or policy.
