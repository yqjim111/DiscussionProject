# Student-written contributions

The student editor autosaves each added/edited bullet through `PUT /api/groups/:groupId/points/:pointId`. PostgreSQL `group_notes` stores the original text and optional original AI text it replaces. Writes are independent by group and point ID; they do not replace an entire group's document. There is no application character limit, bullet-count limit or truncation. The dedicated JSON endpoint accepts large text payloads; renderer previews may shorten their display only.

The editor keeps failed writes in a browser draft when storage is available, and retains them in memory if browser storage quota is exhausted. Save points retries pending changes. Leaving/switching groups or requesting AI analysis first flushes pending writes. New AI summaries do not overwrite saved student contributions. Deleted AI bullets remain suppressed via their saved replacement record. The former editor held edits only in React state; edits already lost before this version cannot be recovered from the server.

Group listing and `group:points:update` expose the saved points, raw AI summary and effective summary to both teacher and student. A teacher can open any online/offline group to inspect a live upper summary/student-points pane and a lower original transcription pane. Dashboard cards show at most four shortened entries and link to the full discussion. These preview limits never affect storage or analysis.

All analysis paths include manual input:

- Student AI summary: original transcript plus explicitly separate manual contributions; works without audio.
- Teacher overall synthesis: effective group summaries include saved manual contributions.
- Shared Argument Map/report job: captures original transcripts, all saved manual points and group members in one source snapshot. Each indexed source records `source_kind` (`manual` or `transcript`) and the manual contribution ID. Citation validation uses actual original contributions; a typed note is never called a spoken utterance.
- PDF and Markdown: preserve the saved map snapshot; the transcript appendix lists student-written contributions separately from recorded speech. Changed points make an existing map/report stale until the teacher regenerates it.

Room/student routes share the light-green control theme. Instructor routes use orange-red controls and accents. Semantic node colors and offline gray status remain independent of these role themes.
