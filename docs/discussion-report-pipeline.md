# Generate Report: discussion-specific analysis

The default pipeline is `discussion-report-v5`. The instructor's **Generate Report** button and dashboard report link use the same durable background job and the same renderer as the exported HTML. Both the frontend and backend must be deployed together.

## Automatic stages

| Stage | AI work | Program checks |
| --- | --- | --- |
| Prepare each whole group | Conservative transcript cleanup and review, then inappropriate-ASR deletion | Preserve private raw input; validate deletions and eligible original text |
| Discover the report frame | Read every group's complete cleaned discussion and typed contributions; infer the report title, section titles, section boundaries and questions | Unique section IDs and titles; substantive input required; no topic/instruction dependency |
| Code each whole group | Extract direct claims and reported supporting cases using the discovered sections | Dynamic section enum; exact original-source quotations; valid local evidence references |
| Consolidate and review | Develop themes and shared claims within sections, then independently review merges and group/evidence membership | Explicit coverage decisions, no invented membership; each group counted once per claim |
| Summarize | Approximately 500 English words synthesizing the reviewed findings | No cases, citations or invented counts in the summary |
| Analyze claim relations | Propose and review SUPPORT, AGAINST and TENSION links among all claims | Valid claim IDs, one final relation per unordered pair, explicit candidate review |
| Analyze tension axes | Infer competing poles, reported conditions and exact source references; independently review axes and any omitted links | Opposite poles for each axis link; valid quotation indices; complete assignment or explicit exclusion; no numerical scores |
| Render and export | No further AI | Consistent HTML/Markdown/JSON/SVG exports, group/student labels, dynamic navigation and numbering |

Section headings are inferred from the actual transcript content, not renamed fixed helpful/unhelpful buckets. Their number can vary. For example, a community transport discussion may have access, crossing safety and coordination sections. A discussion about AI may appropriately generate AI-related sections. Neither the room's last saved teacher topic nor its discussion instructions are needed to discover the frame.

The report contains Summary, the discovered analytical sections, Overall Argument Map with Tension Analysis, and Original/Cleaned Transcripts. Section numbering and navigation adapt automatically. Themes and claims retain global numbering, and evidence uses Claim-based numbering such as Evidence 3.1. Claim details show original quotations before the Evidences synthesis and individual cases. Citation labels include group and recorded member names.

The overall map contains every claim and its theme, uses straight connections with spacious node placement, and supports pan, wheel/button zoom, fit and fullscreen. Tension poles are inferred from the positions and priorities actually discussed; they need not be positive/negative or belong to different sections. Existing benefit/risk reports remain readable. Native disclosure controls support independent and collective transcript expansion/collapse.

## Jobs, reuse and upgrades

An older analysis version is not reused when Generate Report is selected. It is regenerated through the current pipeline. An unchanged, complete v5 result can be reused; changed transcripts trigger a new frame and analysis. Duplicate clicks join the pending job. Failed jobs preserve the prior completed result and reuse only successful checkpoints whose model, prompt, schema and input hashes still match. No synthetic fallback claims or relations are published.

The backend `/health` response exposes `report_pipeline` for deployment verification. The rendered report host also carries the pipeline version. Local source ZIPs, student reports, raw transcripts and checkpoints under `artifacts/` and all `.env` secrets are excluded from publication.

## Prompt entry points

- `server/prompts/discussion_report_plan_prompt.txt`
- `server/prompts/transcript_cleanup_prompt.txt`, `transcript_censor_prompt.txt`
- `server/prompts/claim_group_coding_prompt.txt`, `claim_semantic_synthesis_prompt.txt`, `claim_support_review_prompt.txt`, `claim_report_summary_prompt.txt`
- `server/prompts/overall_claim_relations_prompt.txt`
- `server/prompts/tension_analysis_prompt.txt`, `tension_axis_labels_prompt.txt`

`report-generation.test.js` exercises the actual HTTP Generate Report endpoint with controlled AI/database adapters. It verifies old-report upgrades, inferred headers for a non-AI three-section discussion, the complete report/tension result, unchanged-result reuse, and reanalysis after transcript changes. The existing workflow tests cover authentication, durable jobs, cache failures and concurrent requests.
