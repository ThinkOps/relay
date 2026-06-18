# URL Shortener Token Experiment

This is a small A/B experiment for the claim:

Relay-style bounded context should reduce the amount of context agents need to read during multi-agent handoffs.

## Design

Two groups build the same tiny URL shortener:

- Raw transcript group: one PM, three developers, one reviewer.
- Relay group: one PM, three developers, one reviewer.

The generated app is intentionally small and dependency-free:

- `POST /shorten` creates a short URL.
- `GET /:slug` redirects and increments click count.
- `GET /api/:slug` returns metadata and click count.
- Tests cover create, redirect, stats, invalid URL, and missing slug.

The experiment script writes two identical app directories, runs their tests, seeds a Relay control database for the Relay cohort, and compares the context packet each role would receive.

## Measurement

Exact per-agent token telemetry is not available from the current sub-agent tool surface, so this experiment uses an estimator:

```text
estimated_tokens = ceil(character_count / 4)
```

That is not billable-token proof. It is a context-size proxy. The useful question it answers is:

> How much text did each role have to receive as starting context?

The raw transcript group receives the full accumulated project transcript and repo snapshot. The Relay group receives bounded role briefs plus active context layers.

## Pilot Result

Command:

```bash
node scripts/url-shortener-token-experiment.js
```

The generated URL shortener tests required temporary localhost server access. In this sandbox, that needed an escalated run.

Result from the pilot run:

| Role | Raw transcript est. tokens | Relay brief est. tokens | Saved | Saved % |
| --- | ---: | ---: | ---: | ---: |
| pm | 131 | 126 | 5 | 3.8% |
| dev-1 | 6990 | 1894 | 5096 | 72.9% |
| dev-2 | 6979 | 1871 | 5108 | 73.2% |
| dev-3 | 6981 | 1843 | 5138 | 73.6% |
| reviewer | 9760 | 5409 | 4351 | 44.6% |

Totals:

| Group | Estimated context tokens |
| --- | ---: |
| Raw transcript | 30841 |
| Relay brief/layers | 11143 |

Estimated reduction: 19698 tokens, or 63.9%.

## What This Proves

This supports the narrower claim that bounded Relay briefs and layers can substantially reduce the context text supplied to agents during handoffs.

It does not prove exact model token billing, total wall-clock efficiency, or implementation quality. To prove those, the agent harness needs to expose per-agent usage telemetry:

- input tokens;
- output tokens;
- tool-result tokens;
- total session tokens;
- task outcome quality.

## Why The PM Savings Are Small

The PM starts from the same user goal in both groups. Relay does not save much before the workflow has accumulated history.

The savings appear at handoff time:

- developers avoid receiving the full project transcript;
- reviewers start from human summaries and implementation notes instead of every event;
- each role gets context scoped to the card and role.

## Next Better Experiment

The next version should run actual sub-agent sessions in two cohorts and collect exact usage from the harness. Use the same app, same role count, same acceptance criteria, and same reviewer rubric.

Until exact telemetry is available, this script is a repeatable proxy for context-size savings.
