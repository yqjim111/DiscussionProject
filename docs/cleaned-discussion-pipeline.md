# Whole-group transcript analysis

The current AI reflection report is described in [helpful-unhelpful-report.md](helpful-unhelpful-report.md). It retains whole-group cleanup but replaces the generic statement network with helpful/unhelpful themes, frequency-ranked claims and evidence-to-claim support maps. The generic v2 implementation below remains available for legacy data/tests.

The current method is `cleaned-discussion-v2` (argument/content) and `cleaned-thematic-v2` (thematic). Topic and discussion instructions are retained only as session metadata, never passed as analytic filters. All positive, negative, mixed and conditional rounds are analyzed together.

1. Preserve each complete original group transcript and original typed contributions.
2. AI conservatively cleans the complete group, then a separate AI review checks omissions, wording, paragraph reflow, uncertainty and task changes. There is no mechanical transcript chunking. A deterministic word-order check rejects inserted or reordered words; it cannot by itself establish semantic completeness.
3. Read each complete cleaned group with its originals. AI extracts episodes, complete propositions, account status and exclusions; a separate review checks fidelity and missed substantive passages. Quotations must be exact contiguous original substrings, never cleaned wording presented as original.
4. AI consolidates the complete statement inventory across groups, with a separate consolidation review. Every extracted statement must belong to exactly one cluster. Episode retellings are tracked separately as confirmed or suspected; mentions are not votes. Whitespace-equivalent typed/transcript copies are marked as duplicate sources without deleting either original.
5. AI identifies candidate argument relations. Small sets of candidate pairs are independently reviewed, with an explicit KEEP/REMOVE decision and reason for every candidate; these are semantic candidates, not transcript chunks. Opposed directions for one pair stay in the same review set. Each accepted edge selects original evidence from both endpoints. The published graph has at most one edge per unordered pair. No required edge count, opposing camps or manufactured class-wide thesis. Sparse or empty semantic graphs are valid when the explicit review supports that outcome.
6. Thematic coding independently reads complete cleaned groups and original evidence. The complete codebook with selected original quotations is synthesized and reviewed. This branch does not use argument categories as themes. Axes are optional, with both poles supported.
7. A report summary synthesizes verified statements/evidence and themes. Each group's original is immediately followed by its cleaned transcript and cleanup review notes, in the application and exports.

Whole-group requests may run two at a time. This is concurrency across independent groups, not transcript chunking. The program validates quotation membership, source provenance, full statement coverage during consolidation, and graph/code references. AI review supports human inspection; these checks do not prove every interpretation correct.

Only whitespace differences in quotations can be restored automatically to the exact original substring. Changed wording or punctuation in student evidence is rejected with original-context feedback. Nonverbatim exclusion annotations are explicitly marked unverified and never used as node, episode, edge or thematic evidence. Unassigned thematic code IDs are computed from the actual code inventory minus themed codes; a model cannot delete unmatched codes or invent inventory items through this bookkeeping field.

## Failures and recovery

No original-excerpt fallback graph is produced. Failures stop the stage and preserve original data, completed checkpoints and the previous valid graph. Legacy excerpt fallback maps are excluded from report analysis and map responses. Checkpoints are keyed by model, prompt, schema and input; successful unchanged stages are reusable after a retry/restart. Incomplete outputs never become successful checkpoints. Validation failures record diagnostics and retry; length-limited outputs receive a larger output budget within the bounded retry policy.

The durable worker stores checkpoints in its existing PostgreSQL job input. The standalone rerun command stores them in its output folder. Report summary failures preserve a previous summary with an explicit warning. Failed thematic analysis leaves an already published valid graph intact and marks the job failed.

## Prompts

- `server/prompts/transcript_cleanup_prompt.txt`, with an explicit independent review contract in `transcriptPreparation.js`
- `server/prompts/content_extraction_prompt.txt`, used for extraction and fidelity/coverage review
- `server/prompts/content_merge_prompt.txt`, used for consolidation and review
- `server/prompts/argument_relations_prompt.txt`, used for relation identification and independent verification
- `server/prompts/argument_edge_review_prompt.txt`, used for explicit per-candidate review decisions with complete relevant group context
- `server/prompts/snowball_retelling_prompt.txt`, used for a separate episode-linking pass and review with available group membership metadata; membership alone never proves speaker or episode identity
- `server/prompts/thematic_coding_prompt.txt`, `thematic_synthesis_prompt.txt`, `thematic_review_prompt.txt`
- Summary instructions in `server/services/reportSummary.js`

The older `argument_map_prompt.txt` remains as historical documentation; it is not sent by the new pipeline.

## Reanalyze an exported discussion

Configure `OPENAI_API_KEY` locally (never commit it), then run:

```powershell
python server/scripts/importReportTranscripts.py path/to/discussion-report-520123.zip artifacts/source-session.json
node server/scripts/reanalyzeReport.js artifacts/source-session.json artifacts/reanalyzed-report
```

The importer recovers actual text nodes from the exported HTML appendix, preserving line breaks lost in Markdown. Original database group IDs are absent from that export, so stable import IDs are explicitly identified as such. Output includes a paired original/cleaned appendix, full report HTML/Markdown/JSON, SVG argument map, codebook/evidence, and a ZIP package. Intermediate checkpoints remain local and are not included in the deliverable ZIP.
