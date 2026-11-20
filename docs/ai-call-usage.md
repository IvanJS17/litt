# AI call usage — tokens and engine per call

**Status:** Shipped with Donna triage slice T1 (migration `20261119_60_litt_ai_call_usage.sql`). No visible change for users.

Every model call the retainer flows make leaves one row in `ai_call_usage`: who, where, which route, how many tokens. It is the base for the triage cap (1,000 classifications per firm per month) and the firm's usage view; neither exists yet.

| Column | Meaning |
| --- | --- |
| `engine` | `byok` — a model reached with the user's or firm's own credential. `jev` — TypeSafe's Jev with the platform key (reserved for the triage classifier; nothing writes it yet). |
| `provider`, `model` | The route that answered. For Jev, `typesafe` and the versioned id the response names. |
| `input_tokens`, `output_tokens` | What the provider reported; **null when it reported nothing** (never a guess). |
| `cost_usd` | Null unless a price is known. The repo holds **no price table for language models**, so BYOK rows keep it null and the tokens are the record. Jev is priced from its input tokens (US$0.042 per million, output free; `estimateCostUsd` in `lib/aiCallUsage.ts`). |
| `surface`, `org_id`, `user_id`, `matter_id`, `project_id` | Which flow and for whom. No foreign keys: erasing an account or project is never blocked. |

No prompt, answer, quote, name or key is stored. The table is insert-only (a trigger refuses update and delete), written by the backend role, with no browser policy.

## Where it is recorded

All through `meteredCompletion` (`lib/aiCallUsage.ts`), which passes `onUsage` to `completeText` → `completeAiSdkText` (`lib/llm/aiSdk.ts`), where the AI SDK `generateText` usage is read. A call that fails records nothing; a row that cannot be written leaves one static `[report]` line and never changes the answer.

| Flow | Surface | File |
| --- | --- | --- |
| S6a profile extraction | `profile_extraction` | `modules/client-profile/client-profile.extract.ts` |
| S8a catalog suggestions (one document) | `rule_suggestion_catalog` | `modules/radar/radar.suggest.ts` |
| S8c catalog suggestions (all documents) | `rule_suggestion_catalog_all` | `modules/radar/radar.suggest.all.ts` |
| S8b rule proposals from a law text | `rule_suggestion_law` | `modules/radar/radar.proposals.ts` |

## What already existed

- `citation_support_checks` (Jev, citation check) keeps `model` and `input_tokens` per check; it is not copied here.
- `ai_executions` is the assistant/tabular evidence record (`route_provider`, `route_model`); it has no per-call usage and was not changed.
- The chat egress audit event names provider and model before a call; it cannot hold the tokens, which are known only afterwards.
