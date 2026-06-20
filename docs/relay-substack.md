# Relay: A Human-Readable Control Plane for Agent Work

_Why we built an admin-first workflow for AI agents, what Relay does, how context layers reduce repeated reading, and what is still only a working hypothesis._

_Disclosure: this post was written by Aditya's agent, based on the Relay implementation, docs, and working notes._

AI agents are already useful for individual coding tasks.

They can explore a repo, write a patch, run tests, explain a tradeoff, and hand the result back to a human.

The harder problem starts when the work stops being one prompt and one answer.

What happens when one agent proposes work, another implements it, another reviews it, another tests it, and a human still needs to decide what is allowed to start and what is actually done?

That is the problem Relay is trying to solve.

Relay is an admin-first project board for managing agent work. A PM agent can propose scoped cards. A human admin approves or sends them back. Developer, reviewer, and tester agents work through a shared CLI contract. The human gets a local board, inbox, card timelines, agent presence, dependency visibility, and context gaps.

The goal is not to build Jira for agents.

The goal is narrower: make agent work readable to humans, and make agent context bounded enough that every session does not start from zero.

## The Problem: Agent Work Becomes Unreadable Fast

Single-agent work can stay informal.

You give the agent context. It explores the repo. It makes a change. It runs tests. It reports back.

That breaks down when the work becomes continuous.

The same project starts to involve several roles:

- a PM agent that breaks a goal into cards;
- a developer agent that claims approved work;
- a reviewer agent that checks implementation quality;
- a tester agent that validates behavior;
- a human admin who decides what starts and what is done.

Once that happens, the same questions keep coming back:

- Which cards are approved?
- Who owns this work?
- What did the admin reject last time?
- What changed in the implementation?
- What should the reviewer inspect first?
- Which tests were actually run?
- Is this blocked on another card?
- Is the next agent reading a clean handoff or a long pile of logs?

Without a shared control surface, every new agent session tends to rediscover too much.

It rereads the repo. It rereads the card history. It reconstructs intent from partial notes, stale handoffs, and raw transcripts. That costs tokens, time, and attention. More importantly, it makes the human view blurry.

The human should not need to read an entire agent transcript to answer, "What is waiting on me?" or "Why is this card blocked?"

Relay exists to keep the work visible.

## What Relay Is

Relay has two surfaces.

Agents use a CLI. They can create cards, submit cards, claim work, read briefs, post notes, attach context, move cards through the workflow, check their inbox, inspect dependencies, and ask which transitions are valid.

Humans use a local web UI. They can review pending work, approve or reject cards, inspect timelines, see assigned agents, read context, spot blocked cards, and find cards that are missing handoff information.

Under the hood, Relay is intentionally small: Node.js, built-in SQLite, a plain HTTP server, and static HTML/CSS/JS. The current version has no runtime npm dependencies. That is not just a fun fact; it is a constraint worth protecting because it keeps the local tool inspectable and reduces supply-chain surface area.

The core workflow is:

```text
draft -> pending_approval -> ready -> in_progress -> review -> testing -> done
```

The real graph is not only that straight line. The important transitions are:

| From | To | Who | Why |
| --- | --- | --- | --- |
| `draft` | `pending_approval` | PM or admin | Submit scoped work for approval |
| `needs_changes` | `pending_approval` | PM or admin | Revise and resubmit |
| `pending_approval` | `ready` | admin | Approve execution |
| `pending_approval` | `needs_changes` | admin | Ask PM to revise scope |
| `pending_approval` | `rejected` | admin | Reject work permanently |
| `ready` | `in_progress` | expected role | Claim approved work |
| `ready` | `needs_changes` | admin | Amend approved but unclaimed work |
| `in_progress` | `review` | developer | Hand off implementation for code review |
| `review` | `in_progress` | reviewer | Send findings back to development |
| `review` | `testing` | reviewer | Hand off reviewed work to QA |
| `testing` | `in_progress` | tester | Send failed QA back to development |
| `testing` | `done` | admin | Accept validated work |
| active work | `ready` | admin | Unclaim abandoned work |
| active work | `paused` | admin | Hold work without deleting history |
| active work | `cancelled` | admin | Stop work without deleting history |

`done`, `rejected`, and `cancelled` are terminal states. Relay keeps them because deleting dead work would destroy the audit trail.

At a high level, Relay separates human control from agent execution:

```text
PM agent          Human admin          Dev agent        Reviewer        Tester        Human admin
   |                   |                   |               |              |               |
   | draft card        |                   |               |              |               |
   |------------------>| review scope      |               |              |               |
   |                   | approve/reject    |               |              |               |
   |                   |------------------>| claim + brief |              |               |
   |                   |                   | implement     |              |               |
   |                   |                   |-------------> | review       |               |
   |                   |                   |               |------------> | validate      |
   |                   |                   |               |              |-------------> | mark done
```

That state machine matters.

PM agents can draft and submit cards. Execution starts only after admin approval. Developer agents claim ready work. Reviewers inspect implementation. Testers validate behavior. Admin marks work done.

Relay also supports operational recovery:

- admin can unclaim active work when an agent dies;
- admin can send approved but unclaimed work back for changes;
- cards can declare dependencies with `--blocked-by`;
- blocked ready cards cannot be claimed until blockers are done;
- claim uses an atomic ready-card transition, so two agents cannot both claim the same card;
- agents can ask `relay card transitions <id> --role <role>` instead of learning the workflow by failed commands.

The product is small, but the boundaries are deliberate.

## The Human-Readable View

Agent transcripts are useful for debugging. They are not a management surface.

A human admin should be able to scan:

- what needs approval;
- what is in progress;
- who owns it;
- what is blocked;
- where a reviewer or tester sent work back;
- what evidence exists;
- which cards are missing implementation notes, validation evidence, or human summaries.

Relay turns those questions into board state, inbox items, card timelines, agent presence, dependency signals, and context gaps.

The live board shows the workflow. The approval queue shows cards waiting for a decision. The inbox collects admin-relevant events. Agent presence shows which named agents have checked in recently. Card detail shows the card, notes, context layers, dependencies, and event history.

This is the main human-facing bet: the human should supervise state, summaries, and evidence, not raw conversational noise.

That does not mean Relay tries to make every agent message beautiful. It does not.

Relay's responsibility is to make the important handoff points readable. That is why we added typed context layers, human review summaries, and visible gaps. If an agent writes a messy progress note, the timeline can hold it. But when work moves from developer to reviewer, or reviewer to tester, Relay can require a plain-English summary.

That is the difference between "all output must be perfect" and "the workflow must force readable checkpoints."

## How Work Flows Through Relay

A PM agent starts by creating a scoped card:

```bash
relay card create \
  --feature "Login Revamp" \
  --project "Mobile App" \
  --title "Add reset token expiry" \
  --story "As an account holder, I want expired reset links rejected so old links cannot be reused" \
  --problem "Reset tokens currently remain valid indefinitely. Anyone with an old email link can attempt to reuse it." \
  --ac "Expired reset tokens are rejected" \
  --ac "Valid unexpired reset tokens continue to work" \
  --ac "Tests cover expired, invalid, and valid token paths" \
  --done "Tests pass, PR linked, validation_evidence written" \
  --points 3 \
  --role developer
```

If the work depends on another card, the PM can say that directly:

```bash
relay card create \
  --feature "Login Revamp" \
  --project "Mobile App" \
  --title "Build reset UI" \
  --problem "The UI depends on the reset service contract." \
  --ac "UI calls the reset service" \
  --done "UI tests pass" \
  --blocked-by 12 \
  --role developer
```

Dependency handling stays intentionally simple:

```text
Card #12: Build reset service
    status: done
       |
       v
Card #13: Build reset UI
    blocked-by: #12
    claimable only after #12 is done
```

The PM submits the card:

```bash
relay card submit 13 --actor pm-agent --role pm
```

The admin reviews it. If the card is vague, too large, solution-shaped, or missing testable acceptance criteria, the admin sends it back:

```bash
relay admin changes 13 --reason "Acceptance criteria need clearer pass/fail behavior"
```

If the card is clear enough, the admin approves it:

```bash
relay admin approve 13 --actor aditya
```

Once approved, a developer agent can claim it:

```bash
relay claim 13 --agent dev-agent --role developer --json
```

Claiming returns the role-specific brief immediately. The first read path is already bounded.

During work, the developer posts notes and writes implementation context:

```bash
relay note 13 "Implemented expiry checks and added invalid-token tests." \
  --actor dev-agent \
  --role developer

relay context add \
  --card 13 \
  --type implementation_notes \
  --title "Reset token expiry implementation" \
  --body-file notes.md \
  --actor dev-agent \
  --role developer
```

When the developer moves the card to review, Relay requires a human-readable review summary:

```bash
relay move 13 review \
  --actor dev-agent \
  --role developer \
  --human-summary-file human-summary.md \
  --handoff-file handoff.md
```

That summary is not a transcript. It is a plain-English checkpoint: goal, changes, previous blockers, claimed fixes, remaining risks, and evidence.

The reviewer reads the brief and implementation notes, then either sends the card back to development or moves it to testing with another summary. The tester writes validation evidence. The admin reads the evidence and marks the card done.

This is the shape Relay optimizes for: propose, approve, claim, work, summarize, review, test, close.

## The Token Consumption Problem

The naive way to coordinate agents is to let every agent read everything.

Every agent gets the original goal, the PM plan, all prior notes, every event, implementation details, test output, review findings, and a repo snapshot. Then each agent decides what matters.

That works for small examples. It does not scale well.

There are three common sources of waste:

1. Timeline rereads. Every stage inherits all earlier events, even when most events are irrelevant to the current role.
2. Repo rediscovery. Every agent spends tokens learning the same file layout, commands, conventions, and service boundaries.
3. Unstructured handoffs. The next agent has to infer what matters from notes instead of reading a typed summary.

Relay addresses this with context layers and briefs.

The difference is not that Relay hides context. It changes the default read path:

```text
Raw transcript handoff
  goal + PM plan + all events + all notes + repo snapshot + logs + corrections
       |
       v
  every agent separates signal from noise again

Relay handoff
  card fields + role brief + active layers + recent events + dependency state
       |
       v
  each agent starts from the summary meant for its role
```

## Context Layers: Memory With Boundaries

Context layers are typed markdown artifacts stored outside the raw card timeline. They are durable, scoped, and bounded at write time.

The current layer types are:

- `feature_brief`: product and cross-project context for a feature;
- `project_map`: repo structure, key files, commands, and conventions;
- `implementation_notes`: what changed, why, tradeoffs, and files touched;
- `validation_evidence`: tests run, builds, validation results, and known gaps;
- `handoff_intent`: what the next role should do first;
- `human_review_summary`: a plain-English summary for human and role handoff review.

Each layer type has a character cap. For example, `feature_brief` and `project_map` are capped at 8000 characters, `implementation_notes` and `validation_evidence` at 4000, `human_review_summary` at 3000, and `handoff_intent` at 2000.

These are not exact token limits. Different models tokenize text differently.

Character caps prevent the worst failure mode: unbounded transcript dumps. They do not guarantee quality. An agent can still write 3000 characters of vague prose. That is why caps are paired with typed layer names, admin review, visible gaps, and human summaries.

Layers are immutable. If a layer needs to change, a new layer supersedes the old one. The latest active layer is cheap to read, and the older version remains available for audit.

The important design choice is that Relay does not truncate at read time. Truncation hides information unpredictably. Relay enforces size at write time, while the author still has enough context to produce a deliberate summary.

## Briefs: The Bounded Read Path

The `relay brief` command is the bounded read path.

Instead of returning the full event history, a brief returns:

- the card fields;
- relevant active context layers;
- admin decisions;
- the last few recent events;
- recent send-back reasons when useful;
- dependency state;
- a simple next action.

Different roles get different context.

Developers need the feature brief, project map, handoff intent, and sometimes prior implementation notes. Reviewers need the feature brief, project map, implementation notes, validation evidence, and human review summary. Testers need validation evidence, implementation notes, and the summary. Admin gets the broadest view.

The before-and-after is the point.

Before layers:

```text
read card -> read full timeline -> inspect repo -> infer changed files -> infer tests -> decide what matters
```

After layers:

```text
read brief -> read project_map -> read implementation_notes or validation_evidence -> inspect only what matters
```

Agents can still inspect the repo. Relay is not trying to prevent verification. It is trying to avoid making every agent rediscover the same map before doing useful work.

## A Small Token Experiment

We ran a small repeatable experiment with a tiny URL shortener.

Two groups were modeled:

- Raw transcript group: one PM, three developers, one reviewer.
- Relay group: one PM, three developers, one reviewer.

Both groups built the same app:

- `POST /shorten` creates a short URL;
- `GET /:slug` redirects and increments click count;
- `GET /api/:slug` returns metadata and click count;
- tests cover create, redirect, stats, invalid URL, and missing slug.

The experiment compared the context packet each role would receive. It used this estimator:

```text
estimated_tokens = ceil(character_count / 4)
```

This is not exact billable-token proof. Exact model usage depends on the agent harness, model tokenizer, tool results, output length, and retries.

What it does measure is narrower and still useful: how much starting context each role had to receive.

The pilot result:

| Role | Raw transcript est. tokens | Relay brief est. tokens | Saved |
| --- | ---: | ---: | ---: |
| PM | 131 | 126 | 5 |
| Dev 1 | 6990 | 1894 | 5096 |
| Dev 2 | 6979 | 1871 | 5108 |
| Dev 3 | 6981 | 1843 | 5138 |
| Reviewer | 9760 | 5409 | 4351 |

Totals:

| Group | Estimated context tokens |
| --- | ---: |
| Raw transcript | 30841 |
| Relay briefs and layers | 11143 |

Estimated reduction: 19698 tokens, or 63.9%.

The PM savings are small because the PM starts from the same user goal in both groups. The savings appear at handoff time. Developers avoid receiving the full project transcript. Reviewers start from implementation notes and human summaries instead of every event.

Again, this is a context-size proxy, not a billing claim. To prove total savings, we need exact per-agent input tokens, output tokens, tool-result tokens, retries, and outcome quality from the agent harness.

Still, the direction is useful: bounded context can materially reduce what agents need to read at handoff boundaries.

## Why Not Just Use The Transcript?

The transcript is good for debugging. It is not a durable coordination format.

A transcript mixes discovery, mistakes, dead ends, shell output, corrections, partial plans, and final decisions. Asking the next agent to read all of it is asking that agent to spend tokens separating signal from noise.

Relay still keeps an append-only event trail. The timeline matters.

But the timeline is not the main handoff artifact.

The handoff artifact should answer specific questions:

- What is this feature?
- What is this repo?
- What changed?
- What was verified?
- What should the next role do first?
- What risks remain?

That is what layers and summaries are for.

## What We Learned From Using Relay Hard

The first real stress test was not a polished benchmark. It was using Relay as the coordination substrate for a multi-agent coding session.

That surfaced practical issues quickly.

Agents die. A session can hit a rate limit, stall, or disappear mid-card. Relay now has `relay unclaim <id>` so admin can release active work back to `ready` and preserve an audit event.

Approved cards still need edits. A card can be approved and then reveal a typo, unclear acceptance criterion, or wrong role. Relay now lets admin send a `ready` card back to `needs_changes` before it is claimed.

Dependencies need to be first-class. If a UI card depends on a service card, prose is not enough. Relay now supports `--blocked-by`, shows blockers and dependents, rejects dependency cycles, and prevents blocked ready cards from being claimed.

Claim needs to be atomic. Two agents can see the same ready card at nearly the same time. Relay now uses a conditional ready-card update so only one claimant wins and stale claim attempts cannot overwrite ownership.

Transitions need to be discoverable. Agents should not learn the workflow by failing commands. Relay now has `relay card transitions <id> --role <role>`.

Human summaries matter. From a human perspective, raw agent language can be hard to review. Relay cannot own the quality of every note an agent writes, but it can require a readable summary at key transitions. That is why moving into review or testing requires a human review summary.

These are small details, but they are the details that make agent coordination feel operational instead of theatrical.

## What Is Proven, And What Is Not

Some parts of Relay are implemented and testable.

The state machine exists. Admin approval exists. The CLI and UI exist. Context layers, layer caps, supersession, briefs, inboxes, atomic claim, dependency gates, terminal states, unclaim recovery, transition discovery, safe Markdown rendering, and context gaps exist.

The token experiment supports a narrower claim: Relay-style bounded context can reduce the amount of starting context supplied to agents during handoffs.

Other claims are still unproven.

We have not proven that teams will consistently write good layers. We have not proven exact billable token savings. We have not proven long-term quality improvement. We have not proven that every agent harness will follow the loop without reinforcement.

Those are open questions, not hidden conclusions.

## Open Risks And Design Assumptions

### Agent compliance is still an open risk

Relay assumes agents will check inboxes, claim work, read briefs, write useful notes, and move cards through the workflow.

The tool makes that path easy, but it cannot prove agents will always follow it. That is why key behavior is attached to commands. Claiming returns the brief. Moving cards can write handoff context. Missing layers show up as gaps.

The hypothesis is simple: if the correct path is the easy path, agents are more likely to follow it.

### Context quality is not solved by schema

Relay can require acceptance criteria. It can cap context layers. It can warn when a card is too large. It can show when handoff layers are missing.

It cannot guarantee that a summary is good.

The bet is that typed layers, write-time caps, admin review, and visible gaps make good summaries more likely. That still needs real usage.

### Roles are self-declared

Relay is a coordination protocol, not a security boundary.

A process with access to the database can claim a role. That is acceptable for the current local-first model, but it is not authentication or authorization.

The current control mechanism is visibility: approvals, event history, inbox items, request tokens for local API mutations, and context gaps.

The HTTP API is the natural future boundary for remote agents. Crossing from local-first to remote changes the threat model. Before that ships, Relay needs real authentication and authorization. The self-declared-role model should be treated as a local coordination shortcut, not as something safe to expose over a network.

### Agent-authored Markdown is untrusted

Relay renders agent-authored Markdown in the admin UI. That is useful, but it is also the obvious stored-XSS risk: an agent or compromised input could try to write a script payload into notes or context.

The UI should treat all Markdown as untrusted. The current renderer builds DOM nodes and text nodes for a small safe subset instead of injecting raw HTML. That constraint needs to remain in place if the renderer grows.

### Staleness needs usage data

A `project_map` can become stale. So can a `feature_brief`.

Relay tracks age and supersession, but it does not define a universal staleness rule yet. A map that is 30 days old might be fine in one repo and wrong after a one-day refactor in another.

For now, Relay makes age visible and lets usage reveal where policy is needed.

### SQLite is a first boundary

Relay starts local-first. A shared SQLite database is enough for one machine and multiple agent sessions.

That keeps the system simple and inspectable. It also means Relay is not yet a remote multi-tenant service. The HTTP API is the obvious boundary if remote agents or richer storage become necessary.

## What Relay Is Not

Relay is not a replacement for engineers.

It is not a security product.

It is not a full project management suite.

It does not try to solve capacity planning, long-horizon reporting, complex permissions, or every flavor of agile process.

The first useful version needs to answer a smaller set of questions:

- What work exists?
- Who proposed it?
- Did a human approve it?
- Who is working on it?
- What is blocked?
- What context should the next agent read?
- What evidence exists before we call this done?

If Relay answers those clearly, it earns its place.

## The Principle

The principle behind Relay is simple:

**Human control should be visible, and agent context should be bounded.**

The human-readable side gives the admin a board, inbox, approvals, timelines, agents, dependencies, and gaps.

The agent-readable side gives agents JSON commands, briefs, inboxes, transition discovery, and context layers.

Both sides share the same state machine and event trail.

Relay is not a smarter agent. It is the operational layer around agents: a way to approve work, hand it off, review it, test it, recover it when agents die, and finish it without every session starting from zero.

As agent work becomes more continuous, this layer starts to matter.

Speed without coordination creates noise. Relay is an attempt to turn agent speed into a workflow a human can actually supervise.
