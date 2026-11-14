# Session report and exports

Either **Generate Report** or **Generate Argument Map** can create the shared map. The report reads the same authoritative PostgreSQL result as the interactive map, falling back to the cached map for older deployments. Opening a preview, PDF printing and Markdown ZIP export make no AI calls. **Generate Report** queues the shared background task if no map exists; an existing map is reused. A report request arriving during map generation attaches to that same durable job. Duplicate requests share the pending task. Only an explicit **Regenerate Argument Map** reruns graph extraction.

The report contains:

1. Overall Summary: optional high-level synthesis of all saved map statements. **Generate Report** / **Refresh Overall Summary** calls Luna for this section only, using bounded batches for large inputs. An API error leaves the map, statements and transcripts exportable and preserves any existing summary for the same map.
2. Content Analysis: the saved map's normalized statements, without category grouping, with source group names. No second extraction or alternate FOR/AGAINST/OTHER analysis.
3. Argument Map: those exact nodes grouped as Positive, Negative, Off-topic insight and Related/neutral, followed by a static SVG of every node and saved relationship. No Graph Evidence or text-only Argument Relationships section.
4. Original Transcripts: the map input snapshot, including members and complete original text for each group. Chunk line breaks collapse into a continuous paragraph for each group.

New map jobs retain their full source snapshot in the result, preserving it even if a later job is running or fails. Older completed jobs can use their saved input. If discussion text changes after map generation, regenerate the map to update the report; existing exports retain the original input snapshot. A newer saved map automatically replaces an older report graph and invalidates its old summary.

**Export PDF / Print** uses a static vector image; the report has no pan, zoom or drag canvas. The entire SVG fits inside the printed map area, without clipping any nodes. A very large map is naturally small on A4; use the independent SVG for detailed zooming.

**Export Markdown ZIP** downloads `report.md` and `argument-map.svg`. The Markdown references the image using a relative path. SVG dimensions and viewBox follow the complete graph bounds; labels remain vector text with no raster resolution cap. ZIP exports do not omit nodes or crop to the viewport. Generating a report makes a summary request and, only when needed, creates the shared map. Exporting itself makes no AI requests. The report polls job state; leaving or closing the page does not cancel generation.

Validation covers authoritative map reuse after cache loss, migration from old report snapshots, four categories and source groups, preserving the original transcript snapshot, summary API failure, 305-node/100-edge SVG completeness, Unicode text and independent ZIP CRC/XML validation.

Report generation intent is persisted inside the PostgreSQL map job. The worker publishes the shared graph before running the report summary, so the interactive map can show the result immediately. Lease recovery resumes persisted tasks, and the completion update checks for a report request arriving during map generation. Both pages converge on the same authoritative graph.
