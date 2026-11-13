# Argument Map — Developer Integration

## Overview

The Argument Map feature converts **existing raw group transcripts** from a ClassDiscuss room into a source-traceable network. The model identifies individual ideas (nodes) and evidence-backed connections (edges), and a browser-based viewer renders the validated JSON.

The feature is an instructor-triggered action and does not replace the existing live group summaries, audio transcription, or overall summary. All implementation work is isolated on the `feature/argument-map` branch.

## Components

| File | Role |
| --- | --- |
| `server/prompts/argument_map_prompt.txt` | Analysis specification used verbatim as the core model instruction |
| `server/services/argumentMap.js` | Model call, constrained JSON schema, and basic source/relationship checks |
| `server/routes/argumentMap.js` | Room-scoped API endpoint and demo access-token check |
| `server/index.js` | Registers the route on the existing Express service |
| `app/instructor/[roomCode]/argument-map/page.tsx` | Interactive graph and evidence inspector |
| `app/instructor/[roomCode]/page.tsx` | Instructor dashboard navigation to the graph |

## Data flow

1. A room collects speech-to-text transcripts in Redis as part of the existing ClassDiscuss pipeline.
2. The instructor opens **Argument Map** from their room dashboard, enters the teacher topic and optional discussion instructions, and supplies the demonstration access token.
3. The browser sends a POST to `/api/rooms/:code/argument-map` on the existing Express backend.
4. The server obtains group IDs/names from PostgreSQL and **original transcripts** from Redis. It does not construct the graph from generated summaries.
5. The model receives the saved Argument Map specification, the topic, instructions, and group-labelled transcripts. The implementation requests strict JSON containing `nodes` and `edges`.
6. The server rejects structurally invalid outputs, unsupported node/edge types, missing source quotations, and duplicate unordered node pairs.
7. The browser displays one node and one edge per validated JSON record. Clicking a node or edge reveals its authentic source records or edge justification.

## Setup

Use the existing local project setup documented in the repository README.

Configure the following environment variables in the backend's environment file (typically `.env.local` for local development):

```env
OPENAI_API_KEY=...
ARGUMENT_MAP_MODEL=gpt-4o-mini
ARGUMENT_MAP_ACCESS_TOKEN=replace-with-a-long-random-secret
```

Do not commit actual credentials. `ARGUMENT_MAP_ACCESS_TOKEN` is **demo-only access control**, not production-grade instructor authentication.

Start the existing backend and frontend, then open the instructor room dashboard and use its **Argument Map** navigation link. The server requires a running PostgreSQL, Redis, and OpenAI API configuration; empty rooms have no transcripts to analyze.

## Input limitations

- A teacher topic is required; discussion instructions are optional.
- Group IDs and group names are taken from existing room records.
- Current group-level audio transcripts do not include verified speaker IDs, timestamps, or source offsets. The service requires these missing fields to be `null`.
- Maximum total raw transcript size in this initial integration is 30,000 characters. Larger inputs require context-preserving chunking and global deduplication; do not truncate them.
- The service only analyzes groups that have recorded transcript text.
- The graph is generated on demand and is **not currently persisted** in the database.

## Visualization

- Node labels show full normalized statements; node IDs are available in details.
- Neutral-colored, labeled edges represent `SUPPORTS`, `ATTACKS`, and `SIMILAR_TO`.
- `SUPPORTS` and `ATTACKS` are directed; `SIMILAR_TO` is symmetric and displayed without an arrow.
- Group highlighting is inclusive: a node with multiple group sources remains highlighted when **any** of those groups is selected. This does not imply a group consensus.
- The viewer supports fit, reset layout, JSON export, and click-to-source inspection.
- Graph rendering uses Cytoscape.js loaded from a CDN; network access is needed for that dependency.

## Verification and current limitations

The model prompt describes Stage One (candidate relationship identification) and Stage Two (candidate relationship verification). This initial service performs those stages within **one model request**, followed by server-side structural/source checks. These checks are **not** an independent second AI semantic-verification call. An additional model review pass may be required if independent verification is needed.

The server can verify quotation presence and selected structural constraints but cannot guarantee that every extracted proposition or inferred relationship is semantically correct. Before wider use, evaluate extraction accuracy with representative, authorized sample transcripts.

Run at least the following checks:

1. Generate an Argument Map from a room with two or more nonempty transcripts.
2. Check that each node has one or more exact source quotes and the correct group attribution.
3. Confirm every edge has evidence and that the same unordered node pair is never represented twice.
4. Confirm a shared node remains highlighted under each of its source groups.
5. Check isolated nodes, click-to-source inspection, export JSON, and layout reset.
6. Verify that a room without transcripts returns an informative error and that an invalid access token is rejected.
7. Run `npm run build` and inspect deployment logs. A successful build is not an end-to-end functional test.

## Security and deployment

- Classroom transcript data is sent to the configured external model service. Use only data that is authorized for such processing; anonymize where necessary.
- The new endpoint performs a paid model call. Keep the access token secret and add real user authentication, rate limiting, request quotas, and monitoring before public production use.
- The repository's current server is Express with PostgreSQL and Redis, alongside the Next.js frontend. A frontend-only Vercel deployment cannot replace the full backend and data services.
- A Git branch and its commits do not automatically imply a deployed preview. Test the branch locally or verify a successful preview deployment before sharing a URL.
