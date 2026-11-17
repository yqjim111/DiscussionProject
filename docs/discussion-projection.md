# Discussion instruction projection

Opening Discussion Instruction fills the browser viewport and displays the topic and instructions in large text. The instructor can adjust the text from 24–96 px with −/+; the browser saves that preference per room. Edit discussion switches to the large-text editor. Save Changes returns to presentation mode without closing it, and the existing room update event shares the saved topic/instructions.

The instruction editors on room creation and Edit discussion accept formatted clipboard HTML from Google Slides. Bold, italic, underline, text colors, numbered lists and nested bullet lists persist across saving, reopening and live updates to students. Paste with normal Ctrl/Cmd+V; pasting as plain text discards source formatting. The presentation font controls still set the overall text size. Previously saved plain text remains readable; copy and paste the source again to restore formatting that was already lost.

`rooms.discussion_instructions_html` stores the formatted version alongside the existing plain-text `discussion_instructions` used by analysis and reports. The startup schema migration adds this column automatically; deploy both frontend and backend and restart the backend. All displayed HTML is rebuilt using a tag/style allowlist, removing scripts, event attributes, embeds and source layout CSS. Limits are 5,000 plain-text characters and 100,000 HTML characters; oversized drafts remain editable but cannot be saved. Legacy API writes without HTML clear the formatted version.

Run `node --test server/tests/instruction-rich-text.test.js` for API persistence, reload, broadcast and compatibility checks. Run `node server/tests/instruction-rich-text.browser.js` with Playwright available (or set `PLAYWRIGHT_MODULE` to its module path) and Microsoft Edge installed for browser checks of formatted paste, computed styles, nested markers, reopening, sanitization and plain-text paste.

Full screen requests browser-native fullscreen from a user click. If the browser or embedded frame disallows that request, the presentation remains full-window. Close/Escape returns to the original page. The modal is portalled outside sticky headers, locks background scrolling and keeps keyboard focus within its controls.

The orange-red countdown is optional and shared by the room. Instructors enter minutes (fractions are accepted), then Start/Restart countdown. Pause preserves exact remaining milliseconds, Resume continues them, and Reset returns to the entered duration without running. Editing the minutes and pressing Restart immediately starts the new duration. Students can view the clock but cannot control it.

`rooms.discussion_timer` stores the state and absolute end timestamp in PostgreSQL. `PATCH /api/rooms/:code/timer` requires instructor authentication and serializes concurrent actions with compare-and-swap. Room responses include server time so clients can account for clock differences. All clients derive the countdown from the shared timestamp; interval throttling, closing/reopening the presentation or refreshing does not restart it. No background expiry task is required.

Reaching zero is a presentation cue only. It does not close the room, stop recording, delete transcripts or limit further discussion. Topic, instructions, map and report behavior remain independent of the clock.

The startup schema migration adds the column for existing rooms. Deploy both frontend and backend to enable shared controls. Verification covers wall-clock pause/resume, restart/reset, invalid input, instructor authorization, live room updates and preserving discussion data at zero.
