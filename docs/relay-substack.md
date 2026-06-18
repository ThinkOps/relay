# Relay: A Control Plane for Agent Work

_Why we added human approval, bounded briefs, and context layers before trying to scale multi-agent software work._

AI agents are already useful for individual coding tasks. They can explore a repo, write a patch, run tests, explain tradeoffs, and hand back a result.

The harder problem starts when the work stops being one prompt and one response.

What happens when one agent proposes work, another implements it, another reviews it, another tests it, and a human still needs to decide what is allowed to start and what is actually done?

That is the problem Relay is trying to solve.

Relay is an admin-first project board for managing agent work. PM agents can propose scoped cards, but execution starts only after admin approval. Developer, reviewer, and tester agents work through a shared CLI contract. The human admin gets a local web board, an inbox, approval controls, card timelines, agent presence, and context gaps.

The goal is not to build another general-purpose project management tool. The goal is narrower: give humans a readable control surface, and give agents bounded context so every session does not start from scratch.

## Why Relay Exists

Single-agent work can be informal. You give the agent context, it explores the repo, it makes a change, and it reports back.

Continuous agent work needs more structure.

Once multiple agent sessions are involved, the same questions keep coming back:

- Which cards are approved?
- Who owns this work?
- What did the admin reject last time?
- What changed in the implementation?
- What should the reviewer inspect first?
- Which tests were actually run?
- Is this card waiting on a human, a developer, a reviewer, or a tester?
- Is the next agent reading a clean handoff or a long pile of logs?

Without a shared system, each new session tends to rediscover too much. It reads the repo again. It reads the card history again. It reconstructs intent from notes, timelines, and partial handoffs.

That repeated rediscovery is expensive. It costs tokens, time, and attention. More importantly, it makes the human view of the work blurry.

Relay exists to make agent work visible to humans and bounded for agents.

## What Relay Is

Relay has two main surfaces.

Agents use a CLI. They can create cards, submit cards, claim work, read briefs, post notes, write handoff layers, move cards through the workflow, and check their inbox.

Humans use a local web UI. They can review pending work, approve or reject cards, inspect timelines, see assigned agents, read context, and find cards that are moving without enough handoff information.

Under the hood, Relay is intentionally small: Node.js, built-in SQLite, a plain HTTP server, and static HTML/CSS/JS. The current version has no runtime npm dependencies.

The core workflow is:

```text
draft -> pending_approval -> ready -> in_progress -> review -> testing -> done
```

PM agents can draft and submit cards. Admin approves before execution. Developer agents claim ready work. Reviewers inspect implementation. Testers validate behavior. Admin marks done.

That state machine matters because it keeps the human in the loop at the points that matter most: before work starts and before work is considered finished.

## The Human-Readable View

Agent transcripts are useful, but they are not a management surface.

A human admin should not have to read raw conversations just to answer basic operational questions:

- What needs my approval?
- What is in progress?
- Which agent owns it?
- What changed?
- What evidence exists?
- Where did I ask for changes?
- Which cards are missing handoff context?

Relay turns those questions into board state, inbox items, card timelines, agent presence, and context gaps.

The board shows the workflow. The approval queue shows cards waiting for a decision. The inbox collects admin-relevant events. Agent presence shows who recently touched the system. Card detail shows the history and context around one unit of work.

The intent is simple: keep the human view readable even when the agent side is busy.

## How Agent Work Flows

A PM agent starts by creating a scoped card. A good card names the problem, acceptance criteria, definition of done, target repo, risk level, and expected role.

The PM submits the card. The admin reviews it. If the card is too vague, too large, solution-shaped, or missing testable acceptance criteria, the admin can request changes. If it is clear enough, the admin approves it.

Once approved, a developer agent claims the card. Claiming returns the role-specific brief immediately, so the first read path is already bounded.

During implementation, the developer posts progress and writes `implementation_notes`: what changed, why it changed, tradeoffs, and files touched. When moving the card to review, the developer can also write `handoff_intent`: what the next role should do first.

The reviewer reads the brief and implementation notes, then either sends the card back to development or moves it to testing. The tester writes `validation_evidence`: tests run, builds checked, behavior verified, and known gaps.

The admin can then read the card, the notes, and the evidence before marking it done.

This is the shape Relay is optimizing for: a state machine, a human approval gate, agent-readable commands, and handoff memory between roles.

## The Token Consumption Problem

The naive way to coordinate agents is to let every agent read the full card history and inspect the repo from scratch.

That works for small examples. It does not scale well as a pattern.

There are three obvious sources of waste:

1. Timeline rereads. Every stage inherits all earlier events, even when most events are not useful for the current role.
2. Repo rediscovery. Every agent spends tokens learning the same file layout, commands, conventions, and service boundaries.
3. Unstructured handoffs. The next agent has to infer what matters from notes instead of reading a typed summary.

Relay addresses this with context layers and briefs.

## Context Layers

Context layers are typed markdown artifacts stored outside the raw card timeline. They are durable, scoped, and bounded at write time.

The current layer types are:

- `feature_brief`: product and cross-project context for a feature.
- `project_map`: repo structure, key files, commands, and conventions.
- `implementation_notes`: what changed, why, tradeoffs, and files touched.
- `validation_evidence`: tests run, builds, validation results, and known gaps.
- `handoff_intent`: what the next role should do first.

Each layer type has a character cap. `feature_brief` and `project_map` are capped at 8000 characters. `implementation_notes` and `validation_evidence` are capped at 4000. `handoff_intent` is capped at 2000.

These are not exact token limits. Different models tokenize text differently. But character caps still force the right behavior: agents must summarize. A layer cannot quietly become a dumped transcript.

Layers are immutable. If a layer needs to change, a new layer supersedes the old one. The latest active layer is cheap to read, and the older version remains available for audit.

The important design choice is that Relay does not truncate at read time. Truncation hides information unpredictably. Relay enforces size at write time, while the author still has context and can produce a deliberate summary.

## Briefs

The `relay brief` command is the bounded read path.

Instead of returning the full event history, a brief returns the card fields, relevant active layers, admin decisions, the last few recent events, and a simple next action.

Different roles get different context.

Developers need the feature brief, project map, handoff intent, and sometimes prior implementation notes. Reviewers need the feature brief, project map, implementation notes, and validation evidence. Testers need the feature brief, project map, validation evidence, and implementation notes. Admin gets the broadest view.

The before-and-after is the main point.

Before layers:

```text
read card -> read full timeline -> inspect repo -> infer changed files -> infer tests -> decide what matters
```

After layers:

```text
read brief -> read project_map -> read implementation_notes or validation_evidence -> inspect only what matters
```

Agents can still inspect the repo. Relay is not trying to prevent real verification. It is trying to avoid making every agent rediscover the same map before doing useful work.

## Why Not Just Use The Transcript?

The transcript is good for debugging. It is not a durable coordination format.

A transcript mixes discovery, mistakes, dead ends, test output, corrections, and decisions. Asking the next agent to read all of it is asking that agent to spend tokens separating signal from noise.

Relay still keeps an append-only event trail. The timeline matters. But the timeline is not the main handoff artifact.

The handoff artifact should answer specific questions:

- What is this feature?
- What is this repo?
- What changed?
- What was verified?
- What should the next role do first?

That is what the layers are for.

## Open Risks And Design Assumptions

Some parts of Relay are proven by implementation. Other parts are still design assumptions that need real usage.

The state machine exists. The admin gate exists. The CLI and UI exist. Context layers, body caps, supersession, briefs, inboxes, and context gaps exist.

What is not yet proven is how well teams and agents will follow the loop over time.

### Agent compliance is still an open risk

Relay assumes agents will check inboxes, claim work, read briefs, write useful notes, and move cards with handoff intent.

The tool makes that path easy, but it does not prove agents will always do it. That is why the workflow puts important behavior directly in commands. Claiming returns the brief. Moving can create handoff intent. Missing implementation notes and validation evidence show up as gaps.

This is a design hypothesis: if the correct path is the easy path, agents are more likely to follow it.

### Context quality is not solved by schema

Relay can require acceptance criteria. It can cap context layers. It can warn when a card is too large. It can show when handoff layers are missing.

It cannot guarantee that a summary is good.

The bet is that typed layers, write-time caps, admin review, and visible gaps will improve context quality enough to make multi-agent work manageable. That still needs real-world validation.

### Roles are self-declared

Relay is a coordination protocol, not a security boundary. A process with access to the database can claim a role.

That is acceptable for the current local-first model, but it is not the same as authentication or authorization. The control mechanism is admin visibility: approvals, events, inbox items, and context gaps.

### Staleness needs usage data

A `project_map` can become stale. So can a `feature_brief`.

Relay tracks age and supersession, but it does not define a universal staleness rule yet. A map that is 30 days old might be fine in one repo and wrong after a one-day refactor in another.

For now, Relay makes age visible and lets usage reveal where policy is needed.

### SQLite is a first boundary

Relay starts local-first. A shared SQLite database is enough for one machine and multiple agent sessions.

That keeps the system simple and inspectable. It also means Relay is not yet a remote multi-tenant service. The HTTP API is the future seam if remote agents or richer storage become necessary.

## What Relay Is Not

Relay is not Jira for agents.

It does not try to solve capacity planning, long-horizon reporting, complex permissions, or every flavor of agile process.

The first useful version needs to answer a smaller set of questions:

- What work exists?
- Who proposed it?
- Did a human approve it?
- Who is working on it?
- What context should the next agent read?
- What evidence exists before we call it done?

If Relay answers those questions clearly, it earns its place.

## The Principle

The principle behind Relay is simple:

**Human control should be visible, and agent context should be bounded.**

The human-readable side gives the admin a board, inbox, approvals, timelines, agents, and gaps. The agent-readable side gives agents JSON commands, briefs, inboxes, and context layers. Both sides share the same state machine and event trail.

Relay is not a smarter agent. It is the operational layer around agents: a way to approve work, hand it off, review it, test it, and finish it without every session starting from zero.

As agent work becomes more continuous, this layer starts to matter. Speed without coordination creates noise. Relay is an attempt to turn agent speed into a workflow a human can actually supervise.
