# AI assist

Inline LLM helpers anchored at the cursor, not bolted onto a sidebar.

## Targets

- **Writing**: complete a paragraph, rewrite for tone, summarise a
  long body.
- **Tables**: "add a status field with these enum values", "rewrite
  this column as title-case", "what's the median budget across
  active projects".

## Constraints

- Local-first. The default backend is a local model; cloud is opt-in
  per workspace.
- No silent telemetry. Every request shows where it ran and what got
  sent.
- Works offline for local-model paths.
