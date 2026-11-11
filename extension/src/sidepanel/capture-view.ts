// Diagnostic capture view (I-02, I-03; the real listening UI is I-13).
// Mirrors the offscreen's CAPTURE_DIAG, shows why a session ended, and offers
// to stop the running session when a new start is refused (SPEC §5
// CAPTURE_BUSY). Text goes through textContent only (AGENTS.md R17).
import {
  isCaptureDiag,
  isTerminalCaptureState,
  type CaptureDiag,
  type CaptureErrorCode,
  type CaptureMessage,
  type CaptureState,
  type SessionId,
} from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import {
  ACTIVE_SESSION_KEY,
  LAST_START_KEY,
  isActiveSession,
  isLastStart,
  type ActiveSession,
} from '../shared/session-storage.ts';
import { strings } from '../ui/strings.it.ts';

const t = strings.capture;

/** Diagnostics arrive every 0.5 s; past this the capture may have died (ADR-0003). */
const STALE_AFTER_MS = 3_000;

/** States in which the offscreen is expected to keep reporting. */
const RUNNING: readonly CaptureState[] = ['AUTHORIZING', 'LISTENING', 'WAITING_FOR_SPEECH', 'PAUSED', 'FINALIZING'];

interface ViewState {
  /** Session whose diagnostics are shown and that «Interrompi» stops. */
  live: CaptureDiag | null;
  /** When the live diagnostic arrived (performance.now()). */
  liveAt: number;
  /**
   * Failure of the latest click (lastStart, or a refused start's diagnostic).
   * Kept apart from the live session's own code: the running session's
   * diagnostics, every 0.5 s, must not wipe it (CAPTURE_BUSY prompt).
   */
  startFailure: CaptureErrorCode | null;
  /** The session the service worker routes to, if any. */
  active: ActiveSession | null;
  stopSeq: number;
  /** Sessions already ended: late diagnostics of theirs are ignored and counted. */
  ended: Set<SessionId>;
  ignored: number;
}

function formatMs(seconds: number | null): string {
  return seconds === null ? t.unavailable : `${(seconds * 1000).toFixed(1)} ${t.milliseconds}`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${t.seconds}`;
}

function row(label: string, value: string, testId: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'flex justify-between gap-4 text-sm';
  const term = document.createElement('dt');
  term.className = 'text-slate-600';
  term.textContent = label;
  const def = document.createElement('dd');
  def.className = 'font-mono tabular-nums';
  def.dataset['testid'] = testId;
  def.textContent = value;
  item.append(term, def);
  return item;
}

function paragraph(text: string, testId: string, className: string, role?: string): HTMLElement {
  const p = document.createElement('p');
  p.className = className;
  p.dataset['testid'] = testId;
  if (role !== undefined) p.setAttribute('role', role);
  p.textContent = text;
  return p;
}

function stopButton(label: string, testId: string, onClick: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white';
  button.dataset['testid'] = testId;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function mountCaptureView(root: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'mt-4 space-y-3';
  root.append(section);
  const state: ViewState = {
    live: null,
    liveAt: 0,
    startFailure: null,
    active: null,
    stopSeq: 0,
    ended: new Set(),
    ignored: 0,
  };

  const isRunning = (diag: CaptureDiag | null): diag is CaptureDiag => diag !== null && RUNNING.includes(diag.state);
  const isStale = (): boolean => isRunning(state.live) && performance.now() - state.liveAt > STALE_AFTER_MS;

  const sendStop = (sessionId: SessionId): void => {
    const message: CaptureMessage = { v: 1, type: 'CAPTURE_STOP', reason: 'USER_STOP', sessionId, seq: state.stopSeq++ };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  };

  const render = (): void => {
    const children: HTMLElement[] = [];
    const live = state.live;
    const status = paragraph(live === null ? t.idle : t.states[live.state], 'capture-status', 'text-sm font-medium');
    status.dataset['state'] = live?.state ?? 'IDLE';
    children.push(status);

    if (live?.exitReason != null) {
      children.push(paragraph(t.exitReasons[live.exitReason], 'capture-exit', 'text-sm text-slate-700'));
    }
    if (isStale()) children.push(paragraph(t.stale, 'capture-stale', 'text-sm text-amber-700', 'status'));
    const failure = state.startFailure ?? live?.code ?? null;
    if (failure !== null) {
      children.push(paragraph(t.errors[failure], 'capture-error', 'text-sm text-red-700', 'alert'));
    }

    if (live !== null) {
      const list = document.createElement('dl');
      list.className = 'space-y-1';
      list.append(
        row(t.samples, String(live.samples), 'capture-samples'),
        row(t.sampleRate, live.sampleRate === null ? t.unavailable : `${live.sampleRate} ${t.hertz}`, 'capture-sample-rate'),
        row(t.elapsed, formatSeconds(live.elapsedMs), 'capture-elapsed'),
        row(t.active, formatSeconds(live.activeMs), 'capture-active'),
        row(t.baseLatency, formatMs(live.baseLatency), 'capture-base-latency'),
        row(t.outputLatency, formatMs(live.outputLatency), 'capture-output-latency'),
      );
      children.push(list);
    }

    if (state.startFailure === 'CAPTURE_BUSY' && state.active !== null) {
      // SPEC §5: a refused start offers to stop the first session, in whatever tab it runs.
      const sessionId = state.active.sessionId;
      children.push(
        stopButton(t.stopActive, 'capture-stop-active', () => {
          sendStop(sessionId);
        }),
      );
    } else if (isRunning(live)) {
      const sessionId = live.sessionId;
      children.push(
        stopButton(t.stop, 'capture-stop', () => {
          sendStop(sessionId);
        }),
      );
    }
    section.replaceChildren(...children);
  };

  const onDiag = (diag: CaptureDiag): void => {
    if (state.ended.has(diag.sessionId)) {
      state.ignored++;
      return;
    }
    if (diag.code === 'CAPTURE_BUSY') {
      // A refused second start must not hide the running session, nor count as its sign of life.
      state.startFailure = diag.code;
      state.ended.add(diag.sessionId);
      render();
      return;
    }
    const live = state.live;
    if (live !== null && live.sessionId === diag.sessionId && diag.seq <= live.seq) {
      state.ignored++; // out of order or duplicate
      return;
    }
    state.live = diag;
    state.liveAt = performance.now();
    if (isTerminalCaptureState(diag.state)) {
      state.ended.add(diag.sessionId);
      // The session that made a start busy is over: the refusal no longer holds.
      if (state.startFailure === 'CAPTURE_BUSY') state.startFailure = null;
    }
    render();
  };

  const onLastStart = (value: unknown): void => {
    if (!isLastStart(value)) return;
    state.startFailure = value.failure;
    render();
  };

  const onActive = (value: unknown): void => {
    state.active = isActiveSession(value) ? value : null;
    render();
  };

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isOwnExtensionContext(sender)) return false;
    if (isCaptureDiag(message)) onDiag(message);
    return false;
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    const lastStart = changes[LAST_START_KEY];
    if (lastStart !== undefined) onLastStart(lastStart.newValue);
    const active = changes[ACTIVE_SESSION_KEY];
    if (active !== undefined) onActive(active.newValue);
  });
  void chrome.storage.session
    .get([LAST_START_KEY, ACTIVE_SESSION_KEY])
    .then((items) => {
      onLastStart(items[LAST_START_KEY]);
      onActive(items[ACTIVE_SESSION_KEY]);
    })
    .catch(() => undefined);

  // Re-render once a second so a capture that stopped reporting shows as stale.
  let wasStale = false;
  setInterval(() => {
    const stale = isStale();
    if (stale !== wasStale) render();
    wasStale = stale;
  }, 1_000);
  render();
}
