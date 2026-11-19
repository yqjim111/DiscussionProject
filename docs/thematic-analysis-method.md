# AI-assisted thematic analysis and bipolar axes

This feature is an instructor-reviewable interpretive draft. It is not an autonomous reflexive thematic analysis, a statistical factor analysis, or a validated measurement instrument. All prompts use the application's centrally configured Luna model.

## Research informing the design

- [Byrne, 2022, A worked example of Braun and Clarke's approach to reflexive thematic analysis](https://link.springer.com/article/10.1007/s11135-021-01182-y). The worked example distinguishes initial coding, developing themes, reviewing themes and defining their meaning/boundaries. This motivates explicit codes, central concepts and theme boundaries, rather than treating repeated topic words as finished themes.
- [Cevik & Abu-Zidan, 2025, Utilizing AI-Powered Thematic Analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12226968/). Their three educational datasets illustrate an AI-assisted staged workflow and human refinement. In one example the model proposed more themes than the human analysis, and researchers combined overlapping candidates. This motivates a separate review pass and preserving alternative interpretations rather than accepting the first generated clusters.
- [Large Language Models in Thematic Analysis, 2025 preprint](https://arxiv.org/html/2510.18456v1). Its examples use contextual coding, authentic excerpts and human evaluations between stages. It also reports limitations around latent interpretation. Our pipeline therefore focuses on semantic meanings, records original evidence and labels results as drafts; citation validation is not claimed to validate interpretations.
- [Riemann, 1990, The Bipolarity of Personal Constructs](https://www.tandfonline.com/doi/abs/10.1080/10720539008412806), and [Neimeyer et al., 2005, Difference, Opposite, and Contrast Methods](https://www.tandfonline.com/doi/abs/10.1080/10720530590948791). Bipolar contrasts need methodological care; contrast elicitation is not simply inventing a negative opposite. The app's axes are an additional design interpretation, not a standard required thematic-analysis step or a claim to have conducted repertory-grid interviews.

## Classroom example (illustrative, not an empirical finding)

If students explicitly say both "AI should help students develop their own draft" and "AI could replace the whole drafting process", a possible candidate theme is **Authorship changes with the extent of delegation**. A supported axis could be **Extent of delegated authorship**, from **Assisted student authorship** to **Replaced student authorship**. Both poles must link to the actual original contributions. A conditional view can sit between the endpoints; the app does not numerically score it or divide students into camps.

If the only contribution is "AI makes ideation faster", it may support an efficiency code or tentative theme. It does not establish a dependency pole, an authorship axis, or a two-sided debate. "Ease of use" versus "Privacy" is also not automatically a bipolar axis: these can be separate priorities. A justified tension requires evidence of their actual tradeoff on a stated dimension.

## Execution (previous implementation)

The current implementation uses complete cleaned groups with original evidence and no topic/instruction filtering. See [cleaned-discussion-pipeline.md](cleaned-discussion-pipeline.md). The fragment-batched execution below is historical.

1. **Original input:** use the saved map's full source snapshot, including all groups, recorded transcripts and saved typed contributions. AI group summaries and map sentiment labels are not primary data. Older maps need a recoverable matching source snapshot.
2. **Coding:** index exact source spans Q1, Q2, etc.; process every span in bounded batches. Luna returns specific code labels, meanings and source IDs. The server restores verbatim evidence and source provenance; the model never copies/fabricates quotations.
3. **Theme/axis development:** use the complete code catalogue with its evidence. Themes have a central organizing concept, definition, inclusion/exclusion boundaries and qualifications. Codes may support multiple themes. Meaningful unmatched codes remain explicitly unassigned.
4. **Review pass:** a separate Luna request reviews the candidate against the original code evidence and returns the corrected result. It checks coherence, redundancy, minority/conditional meanings, alternative interpretations and both poles. This model review supports, but does not replace, human review.
5. **Validation/display:** reject unknown code/source/theme IDs, missing code coverage, duplicate identities and axes without distinct support at both poles. Restore authentic quotes and derive source-group counts mechanically. These counts are contributions, not votes, prevalence estimates or importance scores. No saturation or intercoder-agreement claim is made.

Axes can be a **continuum** of approaches/degrees or a **tension** between coexisting priorities. Both/and and intermediate positions are recorded as qualifications. No axes, a tentative sparse theme, or no themes at all can be valid outcomes. No numerical placements, orthogonality claims, sentiment-based axes or fabricated opposites are generated.

## Product and export behavior

Use **Generate Thematic Analysis** below Argument Map. It reuses the saved original-input snapshot and the existing durable background worker; existing graph nodes and edges are unchanged. Navigating away does not cancel the task. A new map starts without the old thematic result, so results are never silently attached to a different discussion snapshot. The analysis is shared with the report and included in Markdown export.

Markdown preserves document structure, emphasis, source quotes, category lists, axes and original contributions. The ZIP also includes the separate complete SVG and a static HTML copy containing the current report's styling and expanded/collapsed detail state. Markdown viewers control their own fonts and CSS; the HTML copy preserves webpage formatting. There is no PDF/print control.

Original coding is batched without truncation. The complete-code synthesis still depends on the provider's context/output limits; if it cannot complete or pass checks, the UI reports unavailability and keeps the map intact, rather than silently dropping evidence or inventing themes. Sparse or noisy inputs cannot guarantee a meaningful theme or bipolar axis. Prompts, model and method version are recorded for inspectability; actual model output still requires instructor review.

## Prompts

- `server/prompts/thematic_coding_prompt.txt`
- `server/prompts/thematic_synthesis_prompt.txt`
- `server/prompts/thematic_review_prompt.txt`

The HTTP API is `POST /api/rooms/:code/thematic-analysis`; its status/result are read through the same Argument Map endpoint. Existing keys and model configuration are reused.
