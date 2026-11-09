// Content script on https://www.youtube.com/watch* (SPEC §5). It will read
// only the standard <video> element and its events, and send the 1 Hz
// heartbeat (ADR-0004). No YouTube internals, ever (AGENTS.md R4, R5).
// Intentionally does nothing until I-03.
export {};
