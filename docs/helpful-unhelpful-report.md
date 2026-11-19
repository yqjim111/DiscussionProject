# Helpful / unhelpful AI reflection report

This is the worked example used to develop the report. The default Generate Report workflow is now topic-independent; see [Discussion-specific report pipeline](discussion-report-pipeline.md).

The current report method is `claim-evidence-v4`. It uses the instructor-confirmed helpful and unhelpful reflection questions, rather than the room's last saved task instructions, to analyze all snowball rounds together.

## Five report sections

1. An English synthesis of approximately 500 words summarizing helpful/unhelpful themes and students' views. The prompt targets 480–520 words with a validation tolerance of 450–550. Specific cases, quotations, counts, evidence discussion and method commentary are excluded from this summary.
2. AI helpful: semantic themes, canonical claims ordered by distinct group frequency within each theme, expandable original claim quotations, and nested numbered evidence with its own original quotations. Per-theme maps show evidence supporting claims.
3. AI unhelpful, with the same organization and interactions.
4. Overall Argument Map: all 45 canonical claims plus the existing theme nodes, with claims linked to their coded themes. Green/rose distinguish helpful/unhelpful nodes; dark nodes are themes. Claim-to-claim analysis permits only SUPPORT, AGAINST and TENSION. Theme membership links are derived from the accepted coding, not re-inferred by AI. Independent review checks all proposed relationships. SUPPORT is a substantive reason for another claim; AGAINST requires incompatible assertions in the same scope; TENSION captures a grounded benefit-risk tradeoff that can coexist across different accounts. Conditional benefit and risk are not automatically contradictions. Below the interactive map, qualitative bipolar axes show the shared process, both poles, reported conditions, claim IDs and exact original quotations with group/student attribution. A separate tension prompt and review check source references and complete relationship coverage. Axes carry no scores, participant positions or invented thresholds. Pan, wheel/button zoom, fit and fullscreen work offline.
5. Paired displayed Original Transcript and Cleaned Transcript for each group. Original text is rendered as one continuous paragraph; cleaned text retains paragraphs. Each group can be collapsed independently, with controls to expand or collapse every group.

## Source handling

Whole-group AI cleanup is retained. A subsequent full-group censor pass identifies inappropriate transcription passages. A deterministic word-list backstop also removes affected whole sentences. These edits apply to displayed original/cleaned transcripts and eligible analysis input. Legitimate criticism, uncertainty and negative AI experiences are retained. Private original inputs and deletion plans remain available locally/in the server job; public reports and exports exclude those private records.

Quotations must match eligible original text. Whitespace and capitalization-only differences can be restored to the real source spelling, without paraphrasing or changing punctuation. Quotations spanning an authorized deletion use the censored-original representation and are marked as such in JSON. No inappropriate text is reconstructed for a quotation.

## Semantic analysis and frequencies

- Read each complete cleaned group and eligible original text to identify helpful/unhelpful claims and concrete experience cases. Previous accepted extractions may be supplied as hints, never as primary evidence.
- Consolidate common substantive meanings into themes and canonical claims. Different tools/projects do not by themselves make different claims; case details belong in evidence. Preserve material conditions and differences.
- A source contribution can express more than one different meaning. It can therefore support multiple distinct claims, but duplicates within one claim never add to its group count.
- The server checks the complete coded inventory. Any omitted member IDs receive a targeted semantic coverage pass; they are assigned or explicitly excluded before frequencies are computed.
- Independently review every proposed group membership and every proposed evidence-to-claim link. Reject mere topic overlap, unsupported conditions and hypothetical scenarios presented as actual outcomes.
- Frequencies are calculated from a set of verified group IDs, not supplied by the model. These are distinct recorded groups, not unique participants, votes or independent experiences; snowball groups can overlap.
- Rank claims within themes by descending group count. Number claims across the report and number cases as Evidence 1.1, 1.2, etc. Maps contain only the reviewed evidence-to-claim SUPPORTS links.

## Prompts

- `server/prompts/transcript_cleanup_prompt.txt`
- `server/prompts/transcript_censor_prompt.txt`
- `server/prompts/claim_group_coding_prompt.txt`
- `server/prompts/claim_semantic_synthesis_prompt.txt` (synthesis, independent review and targeted coverage repair contracts)
- `server/prompts/claim_support_review_prompt.txt`
- `server/prompts/claim_report_summary_prompt.txt`
- `server/prompts/overall_claim_relations_prompt.txt`
- `server/prompts/tension_analysis_prompt.txt`
- `server/prompts/tension_axis_labels_prompt.txt`

The application report and portable HTML share the same renderer. Portable exports include HTML, Markdown, public JSON, a vector support map, and a standalone map viewer. Private checkpoint/deletion files are not included in the ZIP.

```powershell
node server/scripts/reanalyzeClaimReport.js artifacts/discussion-520123-source-session.json artifacts/discussion-520123-v3 artifacts/discussion-520123-v2/report.json
```

The optional previous report preserves already accepted whole-group cleanup and supplies prior ideas. It does not replace checking original quotations or matching the current questions. The raw source-session file is never overwritten.
