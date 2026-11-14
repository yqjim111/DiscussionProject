# Session PDF Report

The instructor report is generated from a single captured snapshot of all groups' original transcripts, including offline and empty groups.

## What the report includes

- Session date and room code.
- Instructor name, teacher topic, and discussion instructions/questions.
- Names of all participating groups.
- **1. Overall Summary:** a high-level synthesis of the entire class discussion.
- **2. Content Analysis:** distinct on-topic statements and arguments, semantically deduplicated across groups with all source group names shown after each statement.
- **3. Argument Map:** the rendered relationship graph, supporting/opposing/other views relative to an explicit discussed proposition, graph evidence and relationship explanations. Open topics are not forced into a pro/con debate.
- **4. Original Transcripts:** each group's name, member list and complete verbatim saved transcription, at the end of the PDF. No transcript is shortened or translated; individual speakers are not inferred.

**Generate Full Report** explicitly calls AI for the content analysis and graph. Both use the same captured original texts; the report and full appendix are saved atomically in Redis. Viewing or printing the saved report makes no new AI calls. If the room content changes later, the report shows a stale-data notice; **Refresh Full Report** captures a new snapshot. A failed refresh preserves the previous complete report. Export is disabled until a complete report and printable diagram are ready.

## Usage

1. Start the app and its PostgreSQL/Redis dependencies. Sign in through the instructor portal.
2. Create a room with instructor name, topic, and optional questions/instructions. There is no time limit.
3. After students have completed their discussions, open **Export PDF** from the Instructor Dashboard.
4. Select **Generate Full Report** (or **Refresh Full Report**) and wait for the analysis and diagram.
5. Review the four sections. Click **Export PDF / Print**, then choose **Save as PDF** in the browser print dialog.

An instructor login session is required to retrieve the report. The printed Argument Map is rasterized from the Cytoscape layout; exact visual placement can differ from the interactive graph view, but nodes and edges refer to the same stored model result.

## Limitations

- PDF output uses the browser's native print-to-PDF function; it does not automatically download a file without the print dialog.
- Generating the AI analysis requires a working backend and a real `OPENAI_API_KEY`. A local test placeholder does not produce actual AI results.
- Content analysis uses `REPORT_MODEL`, falling back to `ARGUMENT_MAP_MODEL` and then `gpt-4o-mini`; the graph uses `ARGUMENT_MAP_MODEL` or `gpt-4o-mini`. Combined transcripts above 180,000 characters are rejected explicitly rather than silently truncated.
- Semantic deduplication and position classification are AI interpretations; quotation presence and group provenance are checked in code, but completeness and semantic accuracy still require instructor review.
- Previous rooms can have no saved instructor name because this metadata was added after initial development.
- The current room deletion flow permanently removes report data along with other session data; export before ending the session.
- Report retrieval uses the existing shared-PIN instructor session. Real deployment should use per-user authorization and implement quotas for AI calls.
