# TODOS

## P3: Prompt injection hardening for email content

Malicious emails could contain text like "IGNORE PREVIOUS INSTRUCTIONS" that might confuse the classification or summarization prompts. Email content should be sandboxed in the LLM prompts (e.g., wrapped in XML tags with explicit instructions to treat it as untrusted data).

For personal use, risk is low. For multi-user deployment, this becomes a real attack vector. Worth doing before sharing with other execs.

**Effort:** S (human: ~1 hour / CC: ~5 min)
**Depends on:** Classification implementation
**Added:** 2026-04-06 via /plan-ceo-review

