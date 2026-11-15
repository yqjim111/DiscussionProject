# Discussion instruction projection

Opening Discussion Instruction fills the browser viewport and displays the topic and instructions in large text. The instructor can adjust the text from 24–96 px with −/+; the browser saves that preference per room. Edit discussion switches to the large-text editor. Save Changes returns to presentation mode without closing it, and the existing room update event shares the saved topic/instructions.

Full screen requests browser-native fullscreen from a user click. If the browser or embedded frame disallows that request, the presentation remains full-window. Close/Escape returns to the original page. The modal is portalled outside sticky headers, locks background scrolling and keeps keyboard focus within its controls.

The orange-red countdown is optional and shared by the room. Instructors enter minutes (fractions are accepted), then Start/Restart countdown. Pause preserves exact remaining milliseconds, Resume continues them, and Reset returns to the entered duration without running. Editing the minutes and pressing Restart immediately starts the new duration. Students can view the clock but cannot control it.

`rooms.discussion_timer` stores the state and absolute end timestamp in PostgreSQL. `PATCH /api/rooms/:code/timer` requires instructor authentication and serializes concurrent actions with compare-and-swap. Room responses include server time so clients can account for clock differences. All clients derive the countdown from the shared timestamp; interval throttling, closing/reopening the presentation or refreshing does not restart it. No background expiry task is required.

Reaching zero is a presentation cue only. It does not close the room, stop recording, delete transcripts or limit further discussion. Topic, instructions, map and report behavior remain independent of the clock.

The startup schema migration adds the column for existing rooms. Deploy both frontend and backend to enable shared controls. Verification covers wall-clock pause/resume, restart/reset, invalid input, instructor authorization, live room updates and preserving discussion data at zero.
