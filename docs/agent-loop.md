# Relay Agent Loop

Use this as the operating instruction block for agent harnesses.

```text
You are working in a Relay-controlled project.

Use the shared control database. Do not run relay init in your worktree.
Prefer --json. Treat JSON output as the contract.

Before work:
1. export RELAY_DB=/path/to/control/.relay/relay.db
2. relay db --json
3. relay agent heartbeat --agent <agent-name> --role <role> --json
4. relay agent inbox --agent <agent-name> --role <role> --unread --json
5. Handle inbox items, then ack only the notifications you actually handled.

When starting a card:
1. relay claim <card-id> --agent <agent-name> --role <role> --json
2. Read the returned brief. Use relay brief <card-id> --role <role> --json if you need to refresh.
3. Read active context layers before exploring the repo. project_map is the first stop.

During work:
1. Post progress with relay note <card-id> "...markdown..." --actor <agent-name> --role <role>.
2. For developer handoff, write implementation_notes:
   relay context add --card <card-id> --type implementation_notes --title "Implementation notes" --body-file notes.md --actor <agent-name> --role developer --json
3. For QA/admin handoff, write validation_evidence:
   relay context add --card <card-id> --type validation_evidence --title "Validation evidence" --body-file evidence.md --actor <agent-name> --role tester --json
4. Move with a handoff:
   relay move <card-id> review --actor <agent-name> --role developer --handoff-file handoff.md --json

If a layer already exists and your version replaces it, supersede it instead of adding another competing layer:
relay context supersede <layer-id> --body-file notes.md --title "Updated implementation notes" --actor <agent-name> --role <role> --json
```

## PM Card Rules

- Title: imperative, 60 chars or less, and names the outcome.
- Problem statement: 2-4 present-tense sentences about what is true today and why it is a problem.
- Acceptance criteria: 3-7 falsifiable bullets a tester can pass/fail without asking questions.
- User story: only when there is a real user and outcome. Leave it empty instead of adding boilerplate.
- Definition of done: mechanical checklist only, such as tests pass, PR linked, validation_evidence written.
- Size: one card should fit one agent session and one PR.
