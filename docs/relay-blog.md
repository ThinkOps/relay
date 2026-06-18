# Relay: A Human-Readable Control Loop for Agent Work

AI agents can write code, review changes, run tests, and propose product work. The hard part is no longer just getting an agent to do one task. The hard part is coordinating several agent sessions without losing human control, burning the same context tokens again and again, or letting work start before a person has agreed that the work is worth doing.

Relay is our answer to that coordination problem.

It is an admin-first project board for managing agent work. PM agents can propose scoped cards, but execution starts only after admin approval. Developer, reviewer, and tester agents work through a shared CLI contract. The human admin gets a local web board, an inbox, approval controls, card timelines, agent presence, and context gaps.

Relay is not trying to be a full project management suite. It is a control loop: propose, approve, claim, work, hand off, review, test, and close. The product is small on purpose because the expensive part of agent work is not usually the button layout. It is the repeated loss of context between sessions.

## Why We Built Relay

When one human asks one agent to make one change, the workflow can be informal. The user gives context, the agent explores the repo, makes a patch, runs tests, and reports back.

That breaks down when the work becomes continuous.

The same project starts to have several roles:

- A PM agent breaks large goals into cards.
- A developer agent claims approved cards and implements them.
- A reviewer agent checks the patch against the acceptance criteria.
- A tester agent validates behavior and writes evidence.
- A human admin decides what is allowed to start and when something is truly done.

Without a shared system, each role has to rediscover too much:

- Which cards are approved?
- What did the admin reject last time?
- Which agent owns this work?
- What did the developer actually change?
- What should the reviewer inspect first?
- Which tests were run?
- Is the card blocked, paused, rejected, or ready?
- Is the next agent reading a clean handoff or a long pile of logs?

This is where agent workflows get expensive. Every fresh session tends to re-read the repo, re-read the full card history, and reconstruct intent from scattered notes. That cost shows up as token consumption, time, and lower quality decisions.

Relay exists to make the agent workflow visible to humans and bounded for agents.

## What Relay Is

Relay is a local coordination tool with two primary surfaces:

- A CLI that agents can use reliably, preferably with JSON output.
- A local web UI that gives the human admin a readable board and inbox.

Under the hood it uses Node.js, built-in SQLite, a plain HTTP server, and static HTML/CSS/JS. The first version has zero runtime npm dependencies. The default database lives in the OS-standard local data directory, with explicit `RELAY_DB`, `--db`, and repo-local `.relay/relay.db` support when needed.

The important pieces are:

- **Admin approval gate:** PM agents can draft and submit cards, but only admin can approve execution.
- **Role-based flow:** cards move through `draft -> pending_approval -> ready -> in_progress -> review -> testing -> done`.
- **Agent ownership:** cards can be claimed by named agents, and recent heartbeats show which agents are online.
- **Append-only event trail:** actions, decisions, notes, and moves are recorded instead of overwritten.
- **Agent inboxes:** comments, admin decisions, send-backs, and mentions route to agents or roles.
- **Context layers:** typed, bounded memory artifacts that prevent every agent from rereading everything.
- **Briefs:** a bounded read path that gives each role the context it needs without returning the whole timeline.

The admin remains in charge. Relay makes it cheap for the admin to say yes, no, pause, ask for changes, or mark work done.

## The Human-Readable View

The web UI is intentionally not a generic dashboard full of analytics. It is a work control surface.

The admin can see:

- all work on a kanban board;
- cards waiting for approval;
- the inbox of admin decisions, agent updates, and waiting follow-up;
- agent presence and assigned work;
- feature and project boards;
- card detail with markdown notes, timeline, links, and context;
- context gaps such as review cards without implementation notes or testing cards without validation evidence.

That matters because agent systems often become opaque. A transcript might contain the truth, but a transcript is not a good management surface. The human needs to answer operational questions quickly:

- What is waiting on me?
- What is moving without enough context?
- Which work has started?
- Which work is done only according to the agent, and which work has evidence?
- Where did I ask for changes, and did the PM address them?

Relay turns those questions into board state, inbox items, card events, and context layers. The goal is not to hide detail. The goal is to put detail behind the right handle so the human can inspect it when needed.

## How The Workflow Works

A typical Relay loop starts with a PM agent creating a scoped card:

```bash
relay card create \
  --feature "Agent Work Control" \
  --project "Relay" \
  --title "Add reset token expiry" \
  --story "As an account holder, I want expired reset links rejected so that old links cannot be reused" \
  --problem "Reset tokens currently remain valid indefinitely. Anyone with an old email link can attempt to reuse it. We need an expiry check before reset completion." \
  --ac "Expired reset tokens are rejected" \
  --ac "Valid unexpired reset tokens continue to work" \
  --ac "Tests cover expired, invalid, and valid token paths" \
  --done "Tests pass, PR linked, validation_evidence written" \
  --points 3 \
  --role developer
```

The PM submits it:

```bash
relay card submit 12 --actor pm-agent --role pm
```

The admin reviews the card in the UI. If it is too vague, too large, solution-shaped, or missing testable criteria, the admin sends it back. If it is clear, the admin approves it:

```bash
relay admin approve 12 --actor aditya
```

A developer agent claims it:

```bash
relay claim 12 --agent dev-agent --role developer --json
```

Claiming returns the card and the role-specific brief. The developer should not need to run a separate discovery sequence before seeing the product context and project map. The correct behavior is built into the first command.

During work, agents post notes and write context layers:

```bash
relay note 12 "Implemented token expiry checks and added invalid-token tests." \
  --actor dev-agent \
  --role developer

relay context add \
  --card 12 \
  --type implementation_notes \
  --title "Reset token expiry implementation" \
  --body-file notes.md \
  --actor dev-agent \
  --role developer
```

When moving the card, the agent can include handoff intent:

```bash
relay move 12 review \
  --actor dev-agent \
  --role developer \
  --handoff-file handoff.md
```

The reviewer reads the brief, checks implementation notes against acceptance criteria, and either sends the card back to `in_progress` or moves it to `testing`. The tester writes validation evidence. The admin reads the evidence and marks the card done.

That is the product shape: a state machine, a human gate, a CLI contract, and enough memory to carry work across roles.

## The Token Consumption Problem

Agent token consumption becomes painful when context is unbounded.

The obvious implementation is to let every agent call `card show`, receive the full event log, read every note, inspect every handoff, and then explore the repository again. That works for a toy card. It fails as a pattern.

There are three recurring sources of waste:

1. **Timeline rereads:** every stage inherits all earlier events, even if most of them are not useful for the current role.
2. **Repo rediscovery:** every agent spends tokens learning the same file layout, test commands, conventions, and service boundaries.
3. **Unstructured handoffs:** the next agent has to infer what matters from conversational notes instead of reading a typed artifact.

Relay addresses this with context layers and briefs.

## Context Layers: The Memory We Added

Context layers are typed markdown artifacts stored outside the raw card timeline. They are durable, scoped, and bounded at write time.

The current layer types are:

- `feature_brief`, capped at 8000 characters: product and cross-project context for a feature.
- `project_map`, capped at 8000 characters: repo structure, key files, commands, and conventions.
- `implementation_notes`, capped at 4000 characters: what changed, why, tradeoffs, and files touched.
- `validation_evidence`, capped at 4000 characters: tests run, builds, validation results, and known gaps.
- `handoff_intent`, capped at 2000 characters: what the next role should do first.

The caps are character caps, not exact token counters, because different models tokenize differently. They still force the right behavior: agents must summarize. Relay does not let a layer become a hidden transcript dump.

Layers are immutable. If a layer needs to change, a new layer supersedes the old one. That gives us two useful properties:

- The latest active layer is cheap to read.
- The older layer still exists for audit and history.

This design avoids a common trap: truncating at read time. Truncation hides information unpredictably. Relay instead enforces size at write time, so the author has to make a deliberate summary.

## Briefs: The Bounded Read Path

The `relay brief` command is the agent-friendly read path.

Instead of returning the full event history, a brief returns:

- the card fields;
- the active layers relevant to the caller's role;
- admin decisions;
- the last five recent events;
- recent send-back reasons for PMs when useful;
- a simple next action sentence.

Different roles get different layer sets. For example:

- Developers need `feature_brief`, `project_map`, `handoff_intent`, and sometimes prior `implementation_notes`.
- Reviewers need `feature_brief`, `project_map`, `implementation_notes`, and `validation_evidence`.
- Testers need `feature_brief`, `project_map`, `validation_evidence`, and `implementation_notes`.
- Admin gets the broadest view because the admin is making final control decisions.

This gives Relay a bounded worst case. A brief can include several layers, but each layer was already capped. Recent events are capped by count. Card fields are structured. The read path does not grow forever just because a card had a long conversation.

The practical effect is simple: agents start from summarized memory instead of raw history.

## Before And After Layers

The token win is not magic compression. It is a different reading pattern.

Before layers, a handoff tends to look like this:

```text
read card -> read full timeline -> inspect repo -> infer changed files -> infer tests -> decide what matters
```

After layers, the handoff is meant to look like this:

```text
read brief -> read project_map -> read implementation_notes or validation_evidence -> inspect only what matters
```

The second path still lets the agent inspect the code. It just avoids making every agent rediscover the same map before doing useful work.

For a developer, `project_map` is the main saver. It captures where things live and how to run the project. For a reviewer, `implementation_notes` are the saver. They say what changed and why, so review starts with intent instead of archaeology. For a tester and admin, `validation_evidence` is the saver. It separates what was actually verified from what the implementation merely claims.

This is also why Relay keeps layers typed. A generic "summary" field would be easy to fill with anything. Typed layers make the handoff question clear.

## Why Not Just Use The Transcript?

Transcripts are useful for debugging. They are not a durable coordination format.

A transcript mixes discovery, mistakes, dead ends, test output, corrections, and final decisions. Asking the next agent to read it all is asking that agent to spend tokens separating signal from noise.

Relay still keeps an append-only event trail, but the event trail is not the primary handoff format. The primary handoff format is a small set of typed layers:

- What is this feature?
- What is this repo?
- What changed?
- What evidence exists?
- What should the next role do first?

Those are the questions agents need answered at handoff time. Layers make those answers explicit.

## Challenges We Had To Accept

Relay is deliberately honest about its limits.

### Agent compliance is the real product risk

Relay works when agents follow the loop:

```text
heartbeat -> check inbox -> claim -> read brief -> work -> note progress -> write layer -> move with handoff
```

The tool can make that path easy, but it cannot magically force every agent harness to behave well. That is why `claim` returns a brief and `move` can write `handoff_intent`. The important behavior is placed directly in the workflow instead of hidden in documentation.

### Roles are self-declared

Relay is a coordination protocol, not a security boundary. If a process can access the database, it can claim to be a role. The local UI has a request token for API mutations, and SQLite queries use prepared statements, but Relay is not pretending to be an authorization system.

The control is visibility. The admin sees approvals, events, inbox items, and context gaps.

### Context quality cannot be fully validated in code

Relay can require acceptance criteria. It can cap layer bodies. It can warn when a card is too large or when review is missing implementation notes.

It cannot guarantee that a summary is good.

That is why the system uses layered pressure instead of fake certainty:

- write-time caps make dumps impossible;
- help text teaches card-writing rules;
- lint warnings steer PM agents before submission;
- admin approval catches weak cards;
- context gaps show missing handoffs.

The goal is not perfect automation. The goal is a workflow where low-quality context is visible and cheap to correct.

### Staleness is hard

A `project_map` can become stale. So can a `feature_brief`. Relay tracks age and supersession, but it does not invent a universal staleness rule. A map that is 30 days old might be fine in a stable repo and wrong after a one-day refactor.

For now, Relay makes age visible and lets usage reveal the right policy.

### SQLite is a deliberate first boundary

Relay starts as a local-first tool. A shared SQLite database is enough for one machine and multiple agent sessions. That keeps the system simple and inspectable.

The HTTP API is the future seam for remote agents or richer storage. We do not need that complexity on day one.

## What Relay Is Not

Relay is not Jira for agents.

It does not try to do capacity planning, long-horizon reporting, complex permissions, or every flavor of agile customization. Those can come later if they serve the control loop.

The first useful version needs to answer a narrower set of questions:

- What work exists?
- Who proposed it?
- Did a human approve it?
- Who is working on it?
- What context should the next agent read?
- What evidence exists before we call it done?

If Relay answers those questions clearly, it earns its place.

## The Design Principle

The core design principle is this:

**Human control should be visible, and agent context should be bounded.**

The human-readable side gives the admin a board, inbox, approvals, timelines, and gaps. The agent-readable side gives agents JSON commands, briefs, inboxes, and context layers. The two sides share the same state machine and event trail.

That is the point of Relay. It is not a smarter agent. It is the operational layer around agents so their work can be approved, handed off, reviewed, tested, and finished without every session starting from scratch.

The more agents we add, the more important this becomes. Speed without coordination creates noise. Relay tries to turn that speed into a workflow a human can actually trust.
