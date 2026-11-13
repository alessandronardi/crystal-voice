// Diagnostic capture view (I-02, I-03, I-17; the real listening UI is I-13).
// Mirrors the offscreen's CAPTURE_DIAG, shows why a session ended, and offers
// to stop the running session when a new start is refused (SPEC §5
// CAPTURE_BUSY). Starts the microphone («Usa il microfono»): the permission is
// checked here first and, if missing, asked in permission.html, since a side
// panel cannot prompt (SPEC §5). A microphone session lives as long as this
// panel: the port opened to the offscreen closes with it. Text goes through
// textContent only (AGENTS.md R17).
import {
  PANEL_PORT_PREFIX,
  isCaptureDiag,
  isTerminalCaptureState,
  type CaptureDiag,
  type CaptureErrorCode,
  type CaptureExitReason,
  type CaptureMessage,
  type CaptureStability,
  type CaptureState,
  type SessionId,
} from '@voicecrystal/contracts';
import { SPLIT_HALF_CONSECUTIVE } from '@voicecrystal/dsp-core';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import {
  ACTIVE_SESSION_KEY,
  LAST_START_KEY,
  isActiveSession,
  isLastStart,
  type ActiveSession,
} from '../shared/session-storage.ts';
import { strings } from '../ui/strings.it.ts';
import { analysisBlock } from './analysis-rows.ts';

const t = strings.capture;

/** Diagnostics arrive every 0.5 s; past this the capture may have died (ADR-0003). */
const STALE_AFTER_MS = 3_000;
/**
 * [H] I-13a, review H-1: a running session silent for this long is lost (no
 * final message will come). Above the 15 s analysis timeout of FINALIZING,
 * which sends no diagnostics, plus the release time.
 */
const LOST_AFTER_MS = 20_000;

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
  /** Envelope seq of this panel's CAPTURE_START and CAPTURE_STOP. */
  seq: number;
  /** Sessions already ended: late diagnostics of theirs are ignored and counted. */
  ended: Set<SessionId>;
  ignored: number;
  /** Microphone sessions seen (own starts and the routing state): their texts differ. */
  micSessions: Set<SessionId>;
  /** The microphone session this panel asked for, and its port to the offscreen. */
  ownMic: SessionId | null;
  port: chrome.runtime.Port | null;
  /** The origin's microphone permission as last seen, null if unknown. */
  micPermission: PermissionState | null;
  /**
   * A microphone start asked by this panel and not answered yet (no
   * diagnostic, no recorded outcome): the button is hidden meanwhile, so a
   * double click cannot start a second request (review M-1).
   */
  micStarting: SessionId | null;
  /** Own microphone session whose port closed with no final diagnostic: the offscreen is gone (review M-2). */
  portLost: SessionId | null;
  /** When the routing state was last seen to change (performance.now()). */
  activeAt: number;
}

/** [H] A start not answered within this time no longer hides «Usa il microfono». */
const START_ANSWER_TIMEOUT_MS = 15_000;

/** Also used by the outcome screen (I-13a, review M-1): the microphone has its own texts (I-17). */
export function errorText(code: CaptureErrorCode, mic: boolean): string {
  if (mic && code in t.micErrors) return t.micErrors[code as keyof typeof t.micErrors];
  return t.errors[code];
}

export function exitText(reason: CaptureExitReason, mic: boolean): string {
  if (mic && reason in t.micExitReasons) return t.micExitReasons[reason as keyof typeof t.micExitReasons];
  return t.exitReasons[reason];
}

/** The extension origin's microphone permission, or null if the browser cannot tell. */
async function micPermission(): Promise<PermissionStatus | null> {
  try {
    return await navigator.permissions.query({ name: 'microphone' });
  } catch {
    return null;
  }
}

function formatMs(seconds: number | null): string {
  return seconds === null ? t.unavailable : `${(seconds * 1000).toFixed(1)} ${t.milliseconds}`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${t.seconds}`;
}

/** I-07: the split-half rule in one line (SPEC §8): reason, s_t and the run out of SPLIT_HALF_CONSECUTIVE. */
function stabilityText(stability: CaptureStability | null): string {
  if (stability === null || stability.evaluations === 0) return t.stabilityNone;
  const reason = stability.converged
    ? t.stabilityReached
    : stability.blockedBy === null
      ? t.stabilityPassed
      : t.stabilityBlocked[stability.blockedBy];
  const s = stability.s === null ? t.stabilityNoS : stability.s.toFixed(1);
  return t.stabilityValue(reason, s, `${stability.consecutive}/${SPLIT_HALF_CONSECUTIVE}`);
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

/** I-13a: what the view machine hears from this view, and what it may ask. */
export interface CaptureViewHooks {
  onDiag?: (diag: CaptureDiag, source: 'tab' | 'mic') => void;
  /** Review H-1: the live session will send nothing more (silent too long, or its panel port lost). */
  onLost?: (sessionId: SessionId) => void;
  /** Review M-3: a start refused or failed (not YouTube, busy, permission), shown on the current screen; null when none. */
  onStartFailure?: (message: string | null, busy: boolean) => void;
}

export interface CaptureViewHandle {
  /** «Interrompi» of the live screen: stops the running session, if any (idempotent). */
  stop(): void;
  /** «Interrompi la cattura in corso» after CAPTURE_BUSY (review M-3). */
  stopActive(): void;
}

export function mountCaptureView(root: HTMLElement, hooks: CaptureViewHooks = {}): CaptureViewHandle {
  const section = document.createElement('section');
  section.className = 'mt-4 space-y-3';
  root.append(section);
  const state: ViewState = {
    live: null,
    liveAt: 0,
    startFailure: null,
    active: null,
    seq: 0,
    ended: new Set(),
    ignored: 0,
    micSessions: new Set(),
    ownMic: null,
    port: null,
    micPermission: null,
    micStarting: null,
    portLost: null,
    activeAt: 0,
  };

  const isRunning = (diag: CaptureDiag | null): diag is CaptureDiag => diag !== null && RUNNING.includes(diag.state);
  const isStale = (): boolean => isRunning(state.live) && performance.now() - state.liveAt > STALE_AFTER_MS;

  /**
   * Whether «Usa il microfono» is offered. Not while a start is pending, nor
   * while a session is alive. A session counts as alive while its
   * diagnostics flow; it stops counting when they go stale, when this panel's
   * own port was lost, or when the routing state names a session that has
   * not reported for a while (the offscreen died with no final message).
   * The service worker then refuses with CAPTURE_BUSY if a document is in
   * fact alive, or clears the stale routing state and starts.
   */
  const canStartMic = (): boolean => {
    if (state.micStarting !== null) return false;
    const live = state.live;
    const lost = (id: SessionId): boolean => id === state.portLost;
    if (isRunning(live) && !isStale() && !lost(live.sessionId)) return false;
    const active = state.active;
    if (active === null || lost(active.sessionId)) return true;
    const reporting = live !== null && live.sessionId === active.sessionId && !isStale();
    return !reporting && performance.now() - state.activeAt > STALE_AFTER_MS;
  };

  const sendStop = (sessionId: SessionId): void => {
    const message: CaptureMessage = { v: 1, type: 'CAPTURE_STOP', reason: 'USER_STOP', sessionId, seq: state.seq++ };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  };

  const closePort = (): void => {
    state.port?.disconnect();
    state.port = null;
  };

  const startMic = async (): Promise<void> => {
    if (state.micStarting !== null) return;
    // Pending from the click on, before any await (review M-1).
    const sessionId = crypto.randomUUID();
    state.micStarting = sessionId;
    render();
    // A side panel cannot show the permission prompt: without a grant, send
    // the user to permission.html (SPEC §5) instead of starting.
    const permission = await micPermission();
    state.micPermission = permission?.state ?? null;
    if (permission !== null && permission.state !== 'granted') {
      state.micStarting = null;
      state.startFailure = 'MIC_PERMISSION_REQUIRED';
      render();
      return;
    }
    state.ownMic = sessionId;
    state.micSessions.add(sessionId);
    state.startFailure = null;
    state.portLost = null;
    const message: CaptureMessage = { v: 1, type: 'CAPTURE_START', source: 'mic', tabId: null, sessionId, seq: state.seq++ };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
    // A start nobody answers must not hide the button for ever.
    setTimeout(() => {
      if (state.micStarting === sessionId) {
        state.micStarting = null;
        render();
      }
    }, START_ANSWER_TIMEOUT_MS);
    render();
  };

  /** The pending start got an answer (a diagnostic or a recorded outcome). */
  const answered = (sessionId: SessionId): void => {
    if (state.micStarting === sessionId) state.micStarting = null;
  };

  const openPermissionPage = (): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }).catch(() => undefined);
  };

  const render = (): void => {
    const children: HTMLElement[] = [];
    const live = state.live;
    const mic = live !== null && state.micSessions.has(live.sessionId);
    const status = paragraph(live === null ? t.idle : t.states[live.state], 'capture-status', 'text-sm font-medium');
    status.dataset['state'] = live?.state ?? 'IDLE';
    status.dataset['source'] = live === null ? '' : mic ? 'mic' : 'tab';
    children.push(status);

    if (live?.exitReason != null) {
      children.push(paragraph(exitText(live.exitReason, mic), 'capture-exit', 'text-sm text-slate-700'));
    }
    if (isStale()) children.push(paragraph(t.stale, 'capture-stale', 'text-sm text-amber-700', 'status'));
    const failure = state.startFailure ?? live?.code ?? null;
    const micFailure = state.startFailure === 'MIC_PERMISSION_REQUIRED' || mic;
    if (failure !== null) {
      children.push(paragraph(errorText(failure, micFailure), 'capture-error', 'text-sm text-red-700', 'alert'));
    }
    hooks.onStartFailure?.(state.startFailure === null ? null : errorText(state.startFailure, micFailure), state.startFailure === 'CAPTURE_BUSY');
    if (mic && isRunning(live)) children.push(paragraph(t.micNote, 'capture-mic-note', 'text-sm text-slate-600'));

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
        row(
          t.validSpeech,
          t.validSpeechOf((live.validSpeechMs / 1000).toFixed(1), String(CAPTURE_LIMITS.maxValidSpeechMs / 1000)),
          'capture-valid-speech',
        ),
        row(t.stability, stabilityText(live.stability), 'capture-stability'),
      );
      children.push(list);
      const a = live.analysis;
      if (a !== null) {
        children.push(
          analysisBlock(
            {
              status: live.state === 'RESULT_READY' ? 'OK' : 'INSUFFICIENT_DATA',
              seed: a.seed,
              warnings: a.quality?.warnings ?? [],
              missingFeatureKeys: a.quality?.missingFeatureKeys ?? [],
              veiledKeys: null,
              validSpeechMs: a.quality?.validSpeechMs ?? null,
              analysedMs: a.analysedMs,
              failure: a.failure,
            },
            'capture',
          ),
        );
      }
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
    // Only while the grant is still missing: an old session's code must not
    // keep sending the user to a page they no longer need.
    if (failure === 'MIC_PERMISSION_REQUIRED' && state.micPermission !== 'granted') {
      children.push(stopButton(t.openPermission, 'capture-open-permission', openPermissionPage));
    }
    if (canStartMic()) {
      children.push(
        stopButton(t.useMic, 'capture-use-mic', () => {
          void startMic();
        }),
      );
    }
    section.replaceChildren(...children);
  };

  /** Attaches this panel to the microphone session it started, once the offscreen reports it. */
  const attachPort = (diag: CaptureDiag): void => {
    if (diag.sessionId !== state.ownMic || state.port !== null || isTerminalCaptureState(diag.state)) return;
    const port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${diag.sessionId}` });
    const sessionId = diag.sessionId;
    port.onDisconnect.addListener(() => {
      // Refused or closed by the offscreen. Normally the session's final
      // diagnostic says why; without one the document is gone (review M-2).
      if (state.port === port) state.port = null;
      if (!state.ended.has(sessionId)) {
        state.portLost = sessionId;
        render();
      }
    });
    state.port = port;
  };

  const onDiag = (diag: CaptureDiag): void => {
    if (state.ended.has(diag.sessionId)) {
      state.ignored++;
      return;
    }
    answered(diag.sessionId);
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
    attachPort(diag);
    hooks.onDiag?.(diag, state.micSessions.has(diag.sessionId) ? 'mic' : 'tab');
    if (isTerminalCaptureState(diag.state)) {
      state.ended.add(diag.sessionId);
      if (diag.sessionId === state.ownMic) closePort();
      // The session that made a start busy is over: the refusal no longer holds.
      if (state.startFailure === 'CAPTURE_BUSY') state.startFailure = null;
    }
    render();
  };

  const onLastStart = (value: unknown): void => {
    // A file start belongs to the file view, which shows its own outcome: here
    // it would wipe a capture's explanation (e.g. NOT_YOUTUBE_WATCH) or show
    // a file's CAPTURE_BUSY twice (I-18, review L5).
    if (!isLastStart(value) || value.source === 'file') return;
    if (value.source === 'mic') state.micSessions.add(value.sessionId);
    // Only a refusal answers a pending start: an accepted one is answered by
    // its first diagnostic, and until then the button stays hidden.
    if (value.failure !== null) answered(value.sessionId);
    state.startFailure = value.failure;
    render();
  };

  const onActive = (value: unknown): void => {
    state.active = isActiveSession(value) ? value : null;
    state.activeAt = performance.now();
    if (state.active?.source === 'mic') state.micSessions.add(state.active.sessionId);
    render();
  };

  // A grant given in permission.html while this panel is open clears the request.
  void micPermission().then((status) => {
    if (status === null) return;
    state.micPermission = status.state;
    status.addEventListener('change', () => {
      state.micPermission = status.state;
      if (status.state === 'granted' && state.startFailure === 'MIC_PERMISSION_REQUIRED') state.startFailure = null;
      render();
    });
    render();
  });

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

  // Re-render once a second so a capture that stopped reporting shows as
  // stale, and «Usa il microfono» comes back when the routing state is orphaned.
  let was = '';
  let lostReported: SessionId | null = null;
  setInterval(() => {
    const live = state.live;
    if (isRunning(live) && lostReported !== live.sessionId && (state.portLost === live.sessionId || performance.now() - state.liveAt > LOST_AFTER_MS)) {
      lostReported = live.sessionId;
      hooks.onLost?.(live.sessionId);
    }
    const now = `${String(isStale())}|${String(canStartMic())}`;
    if (now !== was) render();
    was = now;
  }, 1_000);
  render();
  return {
    stop: () => {
      const live = state.live;
      if (live !== null && isRunning(live)) sendStop(live.sessionId);
    },
    stopActive: () => {
      // SPEC §5: a refused start offers to stop the first session, in whatever tab it runs.
      if (state.active !== null) sendStop(state.active.sessionId);
    },
  };
}
