# Session PDF Report

This feature is developed on `feature/session-pdf-report`, separate from the original Argument Map branch and `main`.

## What the report includes

- Session date and room code.
- Instructor name, teacher topic, and discussion instructions/questions.
- Names of all participating groups.
- The latest generated Overall Class Summary.
- The latest validated Argument Map: a printable diagram image, extracted arguments with their source quotes, and edge relationships with justifications.

The report does not generate new AI output. When either analysis has not been run, the report displays a visible `Not generated yet` placeholder instead of inventing a result. Graph and overall summary are stored in Redis for the lifetime of the Room and removed when the room is deleted.

## Usage

1. Start the app and its PostgreSQL/Redis dependencies. Sign in through the instructor portal.
2. Create a room with instructor name, topic, and optional questions/instructions. There is no time limit.
3. After students have completed their discussions, run **Generate Overall Summary** and **Generate Argument Map**.
4. Return to the Instructor Dashboard and click **Export PDF**.
5. The Session Report page displays the stored results. Click **Export PDF / Print**, then choose **Save as PDF** as the printer destination in your browser.

An instructor login session is required to retrieve the report. The printed Argument Map is rasterized from the Cytoscape layout; exact visual placement can differ from the interactive graph view, but nodes and edges refer to the same stored model result.

## Limitations

- PDF output uses the browser's native print-to-PDF function; it does not automatically download a file without the print dialog.
- Generating the AI analysis requires a working backend and a real `OPENAI_API_KEY`. A local test placeholder does not produce actual AI results.
- Previous rooms can have no saved instructor name because this metadata was added after initial development.
- The current room deletion flow permanently removes report data along with other session data; export before ending the session.
- Report retrieval uses the existing shared-PIN instructor session. Real deployment should use per-user authorization and implement quotas for AI calls.
