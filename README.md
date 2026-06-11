# Relay

Relay is an admin-first project board for managing agent work. PM agents can propose scoped work, but execution starts only after admin approval.

The first version is intentionally small:

- CLI-first workflow
- Local web board UI
- SQLite database at `.relay/relay.db`, with `RELAY_DB` support for a shared control database
- Required acceptance criteria before a card can be submitted
- Agile-inspired card fields: user story, story points, sprint label, acceptance criteria, definition of done
- WIP limits surfaced on the board for ready, in-progress, review, and QA
- Agent presence: recent CLI activity/heartbeats show who is online
- Project and feature side navigation for filtered kanban boards
- Append-only event trail for card activity
- Git repo metadata captured when cards are created

## Stack

- Node.js 22+
- Built-in `node:sqlite` with prepared statements
- Plain Node HTTP server for the local API
- Static HTML/CSS/JS UI
- `node:test` integration tests

There are no runtime npm dependencies in v0. The API boundary is the seam where a React/Vite UI or a richer storage layer can be added later.

## Quickstart

```bash
npm run relay -- init
npm run relay -- project create "Relay"
npm run relay -- feature create "Agent Work Control" --project "Relay"
```

## Shared Agent Setup

Relay should have one control database for the admin board. Do not let each agent initialize its own database inside its own repo unless you are only doing a local experiment.

Create the control database once:

```bash
cd /Users/adityachowdhry/work/project-manager
relay init
relay db
```

Agents working from other repositories should point at that same database:

```bash
export RELAY_DB=/Users/adityachowdhry/work/project-manager/.relay/relay.db
relay db
```

For one command:

```bash
relay --db /Users/adityachowdhry/work/project-manager/.relay/relay.db card show 1 --json
```

When an agent creates a project/card from a target repo, Relay still captures that repo’s git metadata, but stores the work in the shared control database.

Agents should poll their inbox before starting work and whenever they are waiting for feedback:

```bash
relay agent inbox --agent dev-agent --role developer --unread --json
relay agent ack 12 --agent dev-agent --role developer
```

Notifications are created from card events. Admin comments, admin decisions, reviewer/tester send-backs, PM revisions on assigned cards, and `@agent-name` mentions all route back to the relevant agent or role.

Create a scoped card:

```bash
npm run relay -- card create \
  --project "Relay" \
  --feature "Agent Work Control" \
  --title "Build approval-gated CLI" \
  --story "As an admin, I want to approve scoped work before agents start so project execution stays controlled" \
  --problem "Agents need admin approval before execution" \
  --ac "PM can create a complete card" \
  --ac "Admin can approve before work starts" \
  --done "CLI supports submit, approve, claim, and board" \
  --points 3 \
  --sprint "Sprint 1" \
  --risk low \
  --role developer
```

Submit and approve it:

```bash
npm run relay -- card submit 1 --actor pm-agent
npm run relay -- admin approve 1 --actor aditya
npm run relay -- claim 1 --role developer --agent dev-agent
npm run relay -- agent list
npm run relay -- board
```

If admin requests changes, the PM can revise the scoped fields and resubmit:

```bash
npm run relay -- card revise 1 \
  --ac "User can request a reset email" \
  --ac "Expired and invalid tokens are rejected" \
  --done "Flow works and tests cover valid, expired, and invalid tokens" \
  --note "Added the edge cases requested by admin" \
  --submit \
  --actor pm-agent
```

Run the UI:

```bash
npm run ui
```

By default the UI binds to `127.0.0.1:4173`. Use `-- --port 4180` to choose another port:

```bash
npm run ui -- --port 4180
```

The UI has a left panel for context switching:

- `All Work`: every project and feature
- `Inbox`: admin decisions, waiting follow-up, and recent agent updates
- `Needs Approval`: cards waiting for admin approval
- `Agents`: online/offline agents, assigned work, and recent activity
- project links: one kanban board for that project
- feature links: one kanban board for that feature

The filters are URL-based:

```text
/                 all work
/?view=inbox      admin inbox
/?view=approvals  approval queue
/?view=agents     agent activity page
/?view=agents&agent=dev-agent  selected agent detail
/?project=1       project board
/?feature=3       feature board
```

The top summary shows how many agents are online. Agents are considered online when they have recent CLI activity or send an explicit heartbeat:

```bash
npm run relay -- agent heartbeat --role developer --agent dev-agent
npm run relay -- agent list --json
```

Cards show a small ownership tag. Claimed cards show the agent name with an online/offline dot; unclaimed cards show the expected role needed for the work.

The admin Inbox is derived from the same append-only event trail as the card timeline. It is a live triage view over current admin actions and recent agent updates. Agent notifications have separate read/ack state through `relay agent inbox` and `relay agent ack`.

Card updates and long scope fields in the UI support a safe Markdown subset: headings, paragraphs, bullet and numbered lists, blockquotes, fenced code blocks, inline code, bold, and italics. The renderer builds DOM text nodes instead of raw HTML.

## Workflow

Cards move through this lifecycle:

```text
draft -> pending_approval -> ready -> in_progress -> review -> testing -> done
```

The UI labels these in a lighter agile style:

```text
Product Backlog -> Admin Approval -> Ready -> In Progress -> Code Review -> QA -> Done
```

Admin control paths:

```text
pending_approval -> needs_changes
pending_approval -> rejected
active card -> paused
active card -> cancelled
testing -> done
```

Only admin can approve, reject, request changes, pause, cancel, or mark a card done.

The board shows WIP limits for flow control:

- ready: 8
- in progress: 3
- code review: 3
- QA: 3

## Card Requirements

A card must include:

- project
- feature
- title
- problem statement
- acceptance criteria
- definition of done
- target repo
- expected role
- risk level

Acceptance criteria can be passed more than once with `--ac`.

Recommended agile fields:

- `--story`: user story in "As a/I want/so that" form
- `--points`: story points from 0 to 100
- `--sprint`: sprint or iteration label

## CLI Reference

```bash
npm run relay -- help
npm run relay -- project list
npm run relay -- feature list --project "Relay"
npm run relay -- card list
npm run relay -- card show 1
npm run relay -- db
npm run relay -- card revise 1 --ac "Updated criterion" --note "Addressed admin feedback" --submit
npm run relay -- agent heartbeat --role developer --agent dev-agent
npm run relay -- agent list
npm run relay -- admin changes 1 --reason "Acceptance criteria are too vague"
npm run relay -- admin reject 1 --reason "Not a priority"
npm run relay -- move 1 review --role developer
npm run relay -- note 1 "Implemented reset token flow" --role developer
npm run relay -- note 1 $'## Review findings\n- Missing error path\n- Add integration test' --role reviewer
npm run relay -- agent inbox --agent dev-agent --role developer --unread
npm run relay -- agent ack 12 --agent dev-agent --role developer
```

Add `--json` to most commands for agent-readable output.

Notes support Markdown. Agents can pass real multiline strings, or literal `\n` sequences when that is easier from their shell/runtime.

Use `RELAY_DB` or `--db` whenever a command is run outside the control workspace.
Legacy `MISTRI_DB` and `.mistri/mistri.db` workspaces are still discovered so existing shared databases can be migrated deliberately.
The preferred command is `relay`; `mistri` remains a compatibility alias so existing agent harnesses and npm-link symlinks do not break during the rename.

## Security Notes

- SQLite writes use prepared statements.
- CLI and API input is validated at the domain boundary.
- The UI server binds to `127.0.0.1` by default.
- Mutating API requests require a per-process request token.
- The UI uses `textContent` for rendered data.
- Security headers disable framing, MIME sniffing, broad script sources, and caching.
- Do not commit `.relay/`; it contains local project state.

## Tests

```bash
npm test
```

The tests use real temporary SQLite databases. The server test starts a temporary localhost HTTP server.
