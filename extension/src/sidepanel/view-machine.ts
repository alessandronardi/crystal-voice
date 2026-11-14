// View machine of the side panel (SPEC §6.2, ADR-0011; I-13a). Pure: the
// panel feeds it the capture diagnostics and the local-file outcomes, and
// draws the screen it returns. SAVED and COLLECTION arrive with I-14.
//
//   HOME ─ a session starts ─▶ LIVE ─ RESULT_READY (accepted seed) ─▶ REVEALED ─ discard ─▶ HOME
//   LIVE ─ INSUFFICIENT_DATA | INTERRUPTED | ERROR ─▶ OUTCOME ─ dismiss ─▶ HOME
//
// Invariants [F]: no REVEALED without quality.accepted and a seed; old seqs
// and other sessions while one is live are ignored; a session closed by the
// user (discard, dismiss) never comes back from a late diagnostic.
import type { CaptureDiag, CaptureErrorCode, CaptureExitReason, CaptureState, CrystalSeed, QualitySummary, RawMeasureTuple, SessionId } from '@voicecrystal/contracts';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';

export type ViewSource = 'tab' | 'mic' | 'file';

export interface RevealedResult {
  source: ViewSource;
  sessionId: SessionId | null;
  fileName: string | null;
  seed: CrystalSeed;
  quality: QualitySummary;
  extractorVersion: string | null;
  mappingVersion: string | null;
  exitReason: CaptureExitReason | null;
  /** I-13b: raw measures for the live legend (SPEC §13); null when not available. */
  rawMeasures: RawMeasureTuple | null;
}

export interface ViewOutcome {
  source: ViewSource;
  sessionId: SessionId | null;
  state: Extract<CaptureState, 'INSUFFICIENT_DATA' | 'INTERRUPTED' | 'ERROR'>;
  exitReason: CaptureExitReason | null;
  code: CaptureErrorCode | 'FILE_DECODE_FAILED' | null;
  quality: QualitySummary | null;
  /** The source view's own explanation, when it has one (a file refusal, review M-2). */
  message: string | null;
}

export type ViewState =
  | { screen: 'HOME'; closed: readonly SessionId[] }
  | { screen: 'LIVE'; source: ViewSource; sessionId: SessionId | null; fileName: string | null; diag: CaptureDiag | null; closed: readonly SessionId[] }
  | { screen: 'REVEALED'; result: RevealedResult; closed: readonly SessionId[] }
  | { screen: 'OUTCOME'; outcome: ViewOutcome; closed: readonly SessionId[] };

/** What the local-file analysis gave (file-view.ts). */
export interface FileAnalysisOutcome {
  seed: CrystalSeed | null;
  quality: QualitySummary;
  extractorVersion: string | null;
  mappingVersion: string | null;
  rawMeasures: RawMeasureTuple | null;
}

export type ViewEvent =
  | { type: 'CAPTURE_DIAG'; diag: CaptureDiag; source: Exclude<ViewSource, 'file'> }
  | { type: 'FILE_STARTED'; fileName: string }
  | { type: 'FILE_DONE'; result: FileAnalysisOutcome }
  | { type: 'FILE_FAILED'; code: CaptureErrorCode | 'FILE_DECODE_FAILED'; message: string | null }
  | { type: 'FILE_CANCELLED' }
  /** The live capture stopped reporting and its routing is gone (capture-view's stale or lost port): no final message will come (review H-1). */
  | { type: 'CAPTURE_LOST'; sessionId: SessionId }
  | { type: 'DISCARD' }
  | { type: 'DISMISS' };

export const INITIAL_VIEW: ViewState = { screen: 'HOME', closed: [] };

/** How many closed sessions are remembered (enough for late duplicates; bounded). */
const CLOSED_MEMORY = 16;

const TERMINAL: readonly CaptureState[] = ['RESULT_READY', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'ERROR'];

function home(closed: readonly SessionId[], add: SessionId | null): ViewState {
  const next = add === null || closed.includes(add) ? closed : [...closed, add].slice(-CLOSED_MEMORY);
  return { screen: 'HOME', closed: next };
}

/** A revealed crystal needs an accepted quality, a seed and at least 8 s of valid speech (SPEC §6.1, D-AA). */
function revealable(quality: QualitySummary, seed: CrystalSeed | null): seed is CrystalSeed {
  return quality.accepted && seed !== null && quality.validSpeechMs >= CAPTURE_LIMITS.minValidSpeechMs;
}

function endOf(diag: CaptureDiag, source: ViewSource, closed: readonly SessionId[]): ViewState {
  const a = diag.analysis;
  if (diag.state === 'RESULT_READY' && a !== null && a.quality !== null && revealable(a.quality, a.seed)) {
    return {
      screen: 'REVEALED',
      closed,
      result: {
        source,
        sessionId: diag.sessionId,
        fileName: null,
        seed: a.seed,
        quality: a.quality,
        extractorVersion: a.extractorVersion,
        mappingVersion: a.mappingVersion,
        exitReason: diag.exitReason,
        rawMeasures: a.rawMeasures,
      },
    };
  }
  const state = diag.state === 'INTERRUPTED' || diag.state === 'ERROR' ? diag.state : 'INSUFFICIENT_DATA';
  return {
    screen: 'OUTCOME',
    closed,
    outcome: { source, sessionId: diag.sessionId, state, exitReason: diag.exitReason, code: diag.code, quality: a?.quality ?? null, message: null },
  };
}

function onDiag(view: ViewState, diag: CaptureDiag, source: Exclude<ViewSource, 'file'>): ViewState {
  if (view.closed.includes(diag.sessionId)) return view;
  if (view.screen === 'LIVE' && view.source !== 'file') {
    if (diag.sessionId !== view.sessionId) {
      // One capture at a time (SPEC §5): the service worker refuses a second
      // start (CAPTURE_BUSY, filtered by capture-view). So a new session that
      // is alive means the shown one is gone without its final message
      // (review H-1): the new one takes over, the old one is closed. A late
      // final message of another session never replaces the live one.
      if (TERMINAL.includes(diag.state) || diag.state === 'IDLE') return view;
      const closed = view.sessionId === null ? view.closed : home(view.closed, view.sessionId).closed;
      return { screen: 'LIVE', source, sessionId: diag.sessionId, fileName: null, diag, closed };
    }
    if (view.diag !== null && diag.seq <= view.diag.seq) return view;
  }
  if (view.screen === 'LIVE' && view.source === 'file') return view; // the file analysis owns the screen
  // A session already shown as revealed or as an outcome: only a new session takes over.
  const shown = view.screen === 'REVEALED' ? view.result.sessionId : view.screen === 'OUTCOME' ? view.outcome.sessionId : null;
  if (shown === diag.sessionId) return view;
  if (TERMINAL.includes(diag.state)) return endOf(diag, source, view.closed);
  if (diag.state === 'IDLE') return view;
  return { screen: 'LIVE', source, sessionId: diag.sessionId, fileName: null, diag, closed: view.closed };
}

export function viewTransition(view: ViewState, event: ViewEvent): ViewState {
  switch (event.type) {
    case 'CAPTURE_DIAG':
      return onDiag(view, event.diag, event.source);
    case 'FILE_STARTED':
      if (view.screen === 'LIVE' && view.source !== 'file') return view; // a capture is running
      return { screen: 'LIVE', source: 'file', sessionId: null, fileName: event.fileName, diag: null, closed: view.closed };
    case 'FILE_DONE': {
      if (view.screen !== 'LIVE' || view.source !== 'file') return view;
      const r = event.result;
      if (revealable(r.quality, r.seed)) {
        return {
          screen: 'REVEALED',
          closed: view.closed,
          result: {
            source: 'file',
            sessionId: null,
            fileName: view.fileName,
            seed: r.seed,
            quality: r.quality,
            extractorVersion: r.extractorVersion,
            mappingVersion: r.mappingVersion,
            exitReason: null,
            rawMeasures: r.rawMeasures,
          },
        };
      }
      return {
        screen: 'OUTCOME',
        closed: view.closed,
        outcome: { source: 'file', sessionId: null, state: 'INSUFFICIENT_DATA', exitReason: 'QUALITY_REJECTED', code: null, quality: r.quality, message: null },
      };
    }
    case 'FILE_FAILED':
      if (view.screen !== 'LIVE' || view.source !== 'file') return view;
      return {
        screen: 'OUTCOME',
        closed: view.closed,
        outcome: { source: 'file', sessionId: null, state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: event.code, quality: null, message: event.message },
      };
    case 'FILE_CANCELLED':
      return view.screen === 'LIVE' && view.source === 'file' ? home(view.closed, null) : view;
    case 'CAPTURE_LOST':
      if (view.screen !== 'LIVE' || view.source === 'file' || view.sessionId !== event.sessionId) return view;
      return {
        screen: 'OUTCOME',
        closed: view.closed,
        outcome: { source: view.source, sessionId: view.sessionId, state: 'ERROR', exitReason: 'OFFSCREEN_CLOSED', code: null, quality: null, message: null },
      };
    case 'DISCARD':
      return view.screen === 'REVEALED' ? home(view.closed, view.result.sessionId) : view;
    case 'DISMISS':
      return view.screen === 'OUTCOME' ? home(view.closed, view.outcome.sessionId) : view;
  }
}
