# Mistri

Mistri is an admin-first project board for managing agent work. PM agents can propose scoped work, but execution starts only after admin approval.

The first version is intentionally small:

- CLI-first workflow
- Local web board UI
- SQLite database at `.mistri/mistri.db`
- Required acceptance criteria before a card can be submitted
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
npm run mistri -- init
npm run mistri -- project create "Mistri"
npm run mistri -- feature create "Agent Work Control" --project "Mistri"
```

Create a scoped card:

```bash
npm run mistri -- card create \
  --project "Mistri" \
  --feature "Agent Work Control" \
  --title "Build approval-gated CLI" \
  --problem "Agents need admin approval before execution" \
  --ac "PM can create a complete card" \
  --ac "Admin can approve before work starts" \
  --done "CLI supports submit, approve, claim, and board" \
  --risk low \
  --role developer
```

Submit and approve it:

```bash
npm run mistri -- card submit 1 --actor pm-agent
npm run mistri -- admin approve 1 --actor aditya
npm run mistri -- claim 1 --role developer --agent dev-agent
npm run mistri -- board
```

Run the UI:

```bash
npm run ui
```

By default the UI binds to `127.0.0.1:4173`. Use `-- --port 4180` to choose another port:

```bash
npm run ui -- --port 4180
```

## Workflow

Cards move through this lifecycle:

```text
draft -> pending_approval -> ready -> in_progress -> review -> testing -> done
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

## CLI Reference

```bash
npm run mistri -- help
npm run mistri -- project list
npm run mistri -- feature list --project "Mistri"
npm run mistri -- card list
npm run mistri -- card show 1
npm run mistri -- admin changes 1 --reason "Acceptance criteria are too vague"
npm run mistri -- admin reject 1 --reason "Not a priority"
npm run mistri -- move 1 review --role developer
npm run mistri -- note 1 "Implemented reset token flow" --role developer
```

Add `--json` to most commands for agent-readable output.

## Security Notes

- SQLite writes use prepared statements.
- CLI and API input is validated at the domain boundary.
- The UI server binds to `127.0.0.1` by default.
- Mutating API requests require a per-process request token.
- The UI uses `textContent` for rendered data.
- Security headers disable framing, MIME sniffing, broad script sources, and caching.
- Do not commit `.mistri/`; it contains local project state.

## Tests

```bash
npm test
```

The tests use real temporary SQLite databases. The server test starts a temporary localhost HTTP server.

