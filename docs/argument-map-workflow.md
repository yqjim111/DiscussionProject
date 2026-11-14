# Argument Map execution workflow

1. POST `/api/rooms/:code/argument-map` captures every group's original transcript, including offline groups, and returns HTTP 202 with a job ID. No summary is used as input.
2. PostgreSQL stores the queued job and its input. A backend worker claims it with a lease; the browser can navigate away or close. Duplicate clicks reuse the pending job. The startup worker recovers queued jobs and expired running leases after restart.
3. Original texts are indexed as exact excerpts Q1, Q2, etc. Each excerpt retains its group ID and original wording. Long spans are split without silently dropping text.
4. The established semantic rules and boundary examples in `server/prompts/argument_map_prompt.txt` guide atomic proposition extraction, global semantic deduplication, support/attack/similarity identification and verification. The execution contract in `server/services/argumentMapIndexed.js` replaces the old quote-copying JSON with source-ID selection. The model must not generate quotes, group UUIDs, speaker metadata or HTML.
5. The server resolves selected source IDs to original quotes and group IDs, constructs edge evidence from endpoint sources, and validates structure/provenance. Failed validation gets at most three attempts with feedback.
6. A successful AI graph is labeled `ai`. Invalid output, unavailable AI, no substantive arguments or inputs above the analysis window produce an explicitly labeled `extractive_fallback`: original excerpts as UNCLASSIFIED isolated nodes and no invented relationships. Empty transcripts produce an explicit empty result. Fallbacks are not presented as completed semantic argument analysis.
7. The authoritative result and job state are stored in PostgreSQL; Redis also caches the graph. GET on the same URL restores status and results. The page polls every two seconds, and the dashboard link shows Generating / Ready / Retry.
8. The renderer is bundled with the application; a third-party CDN failure cannot leave an otherwise generated graph blank. Large excerpt graphs use a grid layout.

The model still performs edge identification and semantic verification in one request; code validates provenance and structure, not the semantic truth of every argument. No software can guarantee a meaningful argument relationship from arbitrary noise or a successful AI service call during an external outage. Such inputs get transparent excerpt-only results, never fabricated edges.

## Group membership

Leave Group flushes pending audio, releases only the current socket's group membership and clears the saved group selection. The student remains in the classroom and can create or join a different group. Refresh resumes only a membership that was not explicitly left. Former groups and their member lists, summaries and original transcripts remain available; an old group turns gray when its last live connection leaves. Classroom broadcasts and instructions remain available after leaving a group.
