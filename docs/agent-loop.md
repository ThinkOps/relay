# Relay Agent Loop

Use this as the operating instruction block for agent harnesses.

```text
You are working in a Relay-controlled project.

Use the shared control database. Run relay init only if relay db says no database exists.
Prefer --json. Treat JSON output as the contract.

Before work:
1. relay db --json
2. relay agent heartbeat --agent <agent-name> --role <role> --json
3. relay agent inbox --agent <agent-name> --role <role> --unread --json
4. Handle inbox items, then ack only the notifications you actually handled.

When starting a card:
1. relay claim <card-id> --agent <agent-name> --role <role> --json
2. Read the returned brief. Use relay brief <card-id> --role <role> --json if you need to refresh.
3. Read active context layers before exploring the repo. feature_brief gives product/cross-project context; project_map is the repo/service map.

During work:
1. Post progress with relay note <card-id> "...markdown..." --actor <agent-name> --role <role>.
2. For developer handoff, write implementation_notes:
   relay context add --card <card-id> --type implementation_notes --title "Implementation notes" --body-file notes.md --actor <agent-name> --role developer --json
3. For QA/admin handoff, write validation_evidence:
   relay context add --card <card-id> --type validation_evidence --title "Validation evidence" --body-file evidence.md --actor <agent-name> --role tester --json
4. Before moving into review or testing, write a human_review_summary in plain English. It must let a non-specialist admin understand the goal, what changed, prior blockers, claimed fixes, remaining risks, and evidence without reading the raw agent notes.
5. Move with a handoff and human summary:
   relay move <card-id> review --actor <agent-name> --role developer --handoff-file handoff.md --human-summary-file human-summary.md --json

If a layer already exists and your version replaces it, supersede it instead of adding another competing layer:
relay context supersede <layer-id> --body-file notes.md --title "Updated implementation notes" --actor <agent-name> --role <role> --json
```

## Human Review Summary

Required when moving `in_progress -> review` or `review -> testing`.

Use this shape:

```text
Goal:
Plain-English description of what this card is supposed to accomplish.

What changed:
- 3-5 bullets, no repo jargon unless unavoidable.

Previous blockers:
- What review/admin previously rejected, or "None".

Claimed fixes:
- Map each blocker or acceptance criterion to the fix.

Remaining risks:
- Known gaps, scope exclusions, follow-up cards, or "None known".

Evidence:
- Tests/checks run, PR link, and anything not verified.
```

## PM Card Rules

- Title: imperative, 60 chars or less, and names the outcome.
- Problem statement: 2-4 present-tense sentences about what is true today and why it is a problem.
- Acceptance criteria: 3-7 falsifiable bullets a tester can pass/fail without asking questions.
- User story: only when there is a real user and outcome. Leave it empty instead of adding boilerplate.
- Definition of done: mechanical checklist only, such as tests pass, PR linked, validation_evidence written.
- Size: one card should fit one agent session and one PR.

## Model Card

Title: Add rate limiting to the login endpoint

Story: As an account holder, I want repeated failed logins throttled so that my account cannot be brute-forced.

Problem: `/api/login` accepts unlimited attempts. A script can try thousands of passwords per minute against one account. We have no throttling at any layer.

Acceptance criteria:

1. More than 5 failed attempts per IP per minute returns 429.
2. Successful logins are unaffected.
3. The limit resets after 60 seconds.
4. Integration test covers limit, reset, and the happy path.

Definition of done: tests pass, PR linked, validation_evidence layer written.
