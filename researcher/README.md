# Researcher bot

A separate bot with its own brain (the Researcher view inside the Brain tab). It reads sports news daily, files signals and predictions, grades itself, and talks to the main Brain.

## Data (Supabase table `researcher_brain`)
One row per doc per user: `research`, `predictions`, `results`, `scorecard`, `skills`, `briefing`.
Strings are stored as `{text}`, arrays as `{items}`, objects as-is.

## Daily filing
`POST {SUPABASE_URL}/functions/v1/researcher-ingest` with header `x-ingest-key: <RESEARCHER_KEY secret>` and body:

```json
{"docs":{"research":{...},"predictions":[...],"results":[...],"scorecard":{...},"skills":"markdown","briefing":"markdown"}}
```

You can also import the files from the Researcher view ("Import its files"): research_*.json, briefing_*.md, predictions.jsonl, results.jsonl, scorecard.json, skills.md.

Graded results (results.jsonl lines) should look like `{"id":"P-...","correct":true,"notes":"..."}`.

## Talking to the main Brain
- Main Brain AI reads a compact version of the Researcher's notes automatically (toggle: "Use Researcher intel").
- "Council" asks the Researcher for a BOOST / AVOID / WATCH memo, then the Brain answers it against your plan and stake caps.
