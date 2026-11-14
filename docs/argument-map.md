# Argument Map — Developer Integration

The current execution flow is documented in [Argument Map workflow](argument-map-workflow.md). It uses durable PostgreSQL jobs, indexed original-source references and explicit excerpt-only fallbacks; the legacy quote-copying execution notes below are historical.

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
2. The instructor signs in through the existing Instructor Portal and creates a room with a **Teacher Topic**, optional **Discussion Instructions**, and a planned **Duration**. These values are saved in PostgreSQL.
3. The instructor opens **Argument Map** from the room dashboard. The browser sends a POST to `/api/rooms/:code/argument-map` on the existing Express backend.
4. The server verifies the instructor's server-side session, loads the room's saved topic and instructions plus group IDs/names from PostgreSQL, and reads **original transcripts** from Redis. It does not construct the graph from generated summaries.
5. The model receives the saved Argument Map specification, the topic, instructions, and group-labelled transcripts. The implementation requests strict JSON containing `nodes` and `edges`.
6. The server rejects structurally invalid outputs, unsupported node/edge types, missing source quotations, and duplicate unordered node pairs.
7. The browser displays one node and one edge per validated JSON record. Clicking a node or edge reveals its authentic source records or edge justification.

## Setup

Use the existing local project setup documented in the repository README.

Configure the following environment variables in the backend's environment file (typically `.env.local` for local development):

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=...
INSTRUCTOR_PIN=replace-with-a-private-instructor-pin
# Prompted text analysis uses gpt-6-luna through server/services/textModel.js.
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000
```

Do not commit real credentials. `INSTRUCTOR_PIN` is validated by the Express server; the Argument Map does **not** ask for a separate demo access token. Authentication is maintained in a server-backed HttpOnly cookie using Redis, with a 12-hour expiry. An instructor login is required to create a room and generate an Argument Map. This remains a simplified shared-PIN authentication scheme, not per-user authorization.

If Next.js starts on port 3001 due to port 3000 being occupied, run Express on a **different port**, and set `NEXT_PUBLIC_SOCKET_URL` and `FRONTEND_URL` to match the actual backend/frontend URLs. Restart the services after changing the environment values.

Start the existing backend and frontend, then open the instructor room dashboard and use its **Argument Map** navigation link. The server requires a running PostgreSQL, Redis, and OpenAI API configuration; empty rooms have no transcripts to analyze.

## Input limitations

- A teacher topic and instructor name are required at **room creation**; instructions are optional. Topic and instructions can be changed through Discussion Instruction during the session. There is no duration or timed expiry.
- Group IDs and group names are taken from existing room records.
- Current group-level audio transcripts do not include verified speaker IDs, timestamps, or source offsets. The service requires these missing fields to be `null`.
- Maximum combined raw transcript input is 180,000 characters. Larger inputs are explicitly rejected, never truncated or analyzed partially.
- The service includes every group with recorded original transcript text, including offline groups. It never uses AI summaries as input. The input panel exposes each group's text and character count; saved graph metadata records the input group counts.
- Older sessions without a topic can be updated through Discussion Instruction.
- Generated graphs and input metadata are saved in Redis until the instructor ends the session.

## Visualization

- Node labels show full normalized statements; node IDs are available in details.
- Neutral-colored, labeled edges represent `SUPPORTS`, `ATTACKS`, and `SIMILAR_TO`.
- `SUPPORTS` and `ATTACKS` are directed; `SIMILAR_TO` is symmetric and displayed without an arrow.
- Group highlighting is inclusive: a node with multiple group sources remains highlighted when **any** of those groups is selected. This does not imply a group consensus.
- The viewer supports fit, reset layout, JSON export, and click-to-source inspection.
- Graph rendering uses Cytoscape.js bundled with the application; no external renderer CDN is needed.

## Verification and current limitations

The prompt describes candidate relationship identification and verification within one model request, followed by server-side structural/source checks. A rejected graph is retried with validation feedback (up to three total model requests). Quotes must match the cited group's original text. Only whitespace differences are repaired mechanically, restoring the exact original text; paraphrases are rejected. These checks are not an independent AI semantic-verification call.

The server can verify quotation presence and selected structural constraints but cannot guarantee that every extracted proposition or inferred relationship is semantically correct. Before wider use, evaluate extraction accuracy with representative, authorized sample transcripts.

Run at least the following checks:

1. Generate an Argument Map from a room with two or more nonempty transcripts.
2. Check that each node has one or more exact source quotes and the correct group attribution.
3. Confirm every edge has evidence and that the same unordered node pair is never represented twice.
4. Confirm a shared node remains highlighted under each of its source groups.
5. Check isolated nodes, click-to-source inspection, export JSON, and layout reset.
6. Verify that a room without transcripts returns an informative error and that unauthenticated analysis requests return HTTP 401.
7. Run `npm run build` and inspect deployment logs. A successful build is not an end-to-end functional test.

## Security and deployment

- Classroom transcript data is sent to the configured external model service. Use only data that is authorized for such processing; anonymize where necessary.
- The new endpoint performs a paid model call. A shared instructor PIN and Redis-backed session are required, but per-user roles, access authorization, rate limiting, quotas, CSRF protections for unusual clients, and monitoring should be evaluated before public production use.
- The repository's current server is Express with PostgreSQL and Redis, alongside the Next.js frontend. A frontend-only Vercel deployment cannot replace the full backend and data services.
- The original database schema is extended using backward-compatible `ALTER TABLE` statements, applied when the Express service starts.
- A Git branch and its commits do not automatically imply a deployed preview. Test the branch locally or verify a successful preview deployment before sharing a URL.
