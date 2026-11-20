# Current instructor workflow

The dashboard's former Generate Report option is replaced by **Download transcription**. It downloads one UTF-8 `.txt` file containing every group's name, recorded member names and original transcript. Original wording and line breaks are preserved; no cleanup, censorship, AI summary or analysis is run for this download. Empty/offline groups remain included. The authenticated endpoint is `GET /api/rooms/:code/transcription`.

**Generate Argument Map** now requests the independent `simple-argument-map-v1` workflow:

1. Clean and review each complete group's transcript using the accepted conservative cleanup prompt. Exclude inappropriate ASR passages from map input while keeping the private original unchanged.
2. Extract direct claims with conditions and exact original quotations. No report plan, section generation or separate evidence-case extraction.
3. Consolidate equivalent claims and organize them into themes, following the successful HTML report's semantic grouping and source-membership principles. Count each group once per canonical claim.
4. Analyze only SUPPORT and AGAINST relationships using exact quotation indices, then draw the claim/theme network. No summary, tension axes, similarity or hierarchy analysis.

The interactive map displays themes and claims, supports pan/zoom and group highlighting, uses straight connections, and shows original quotations on inspection. Semantic edges are stored as the existing `SUPPORTS`/`ATTACKS` contract and displayed as **support**/**against**. Unlabelled theme membership lines are derived from the accepted theme assignments. Isolated claims remain visible. Thematic-analysis generation controls are removed from this map page.

The map job is still durable: navigation does not cancel it, successful checkpoints can be reused on retry, and a failed analysis preserves the prior valid map. Simple-map jobs do not run the report or extended thematic/tension stages even if a legacy request attaches those flags. Existing report APIs/tooling remain for backward compatibility; the UI has no Generate Report entry point, and the old report URL now shows transcription download only.

Prompts: `transcript_cleanup_prompt.txt`, `transcript_censor_prompt.txt`, `map_claims_prompt.txt`, `map_themes_prompt.txt`, `map_relations_prompt.txt`. Cleanup and exact-source validation reuse the previously accepted report implementation. Download access requires instructor authentication and never exposes the download to public group routes.

Tests cover the four-stage contract, support/against types, theme visualization, exact original-source attribution, raw download preservation and zero AI/job calls during download. Production `/health` exposes `argument_map_pipeline` to verify the deployed version.
