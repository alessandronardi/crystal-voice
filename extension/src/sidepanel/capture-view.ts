// Diagnostic capture view for the I-02 PoC (the real listening UI is I-13).
// Shows the live CAPTURE_DIAG of the offscreen and failures recorded by the
// service worker. Text goes through textContent only (AGENTS.md R17).
import {
  isCaptureDiag,
  isCaptureErrorCode,
  isSessionId,
  type CaptureDiag,
  type CaptureErrorCode,
  type CaptureMessage,
  type SessionId,
} from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { LAST_START_KEY } from '../shared/session-storage.ts';
import { strings } from '../ui/strings.it.ts';

const t = strings.capture;

interface ViewState {
  /** Session whose diagnostics are shown and that «Interrompi» stops. */
  live: CaptureDiag | null;
  failure: CaptureErrorCode | null;
  stopSeq: number;
  /** When the live diagnostic arrived (performance.now()). */
  liveAt: number;
  /** Sessions already stopped or failed: late diagnostics of theirs are ignored and counted. */
  ended: Set<SessionId>;
  ignored: number;
}

/** Diagnostics arrive every 0.5 s; past this the capture may have died (ADR-0003). */
const STALE_AFTER_MS = 3_000;

function formatMs(seconds: number | null): string {
  return seconds === null ? t.unavailable : `${(seconds * 1000).toFixed(1)} ${t.milliseconds}`;
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

export function mountCaptureView(root: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'mt-4 space-y-3';
  root.append(section);
  const state: ViewState = {
    live: null,
    failure: null,
    stopSeq: 0,
    liveAt: 0,
    ended: new Set(),
    ignored: 0,
  };
  const isActive = (diag: CaptureDiag | null): boolean =>
    diag !== null && (diag.state === 'starting' || diag.state === 'running');
  const isStale = (): boolean => isActive(state.live) && performance.now() - state.liveAt > STALE_AFTER_MS;

  const render = (): void => {
    const children: HTMLElement[] = [];
    const status = document.createElement('p');
    status.className = 'text-sm font-medium';
    status.dataset['testid'] = 'capture-status';
    const live = state.live;
    status.textContent = live === null ? t.idle : t.states[live.state];
    children.push(status);

    if (isStale()) {
      const stale = document.createElement('p');
      stale.className = 'text-sm text-amber-700';
      stale.dataset['testid'] = 'capture-stale';
      stale.setAttribute('role', 'status');
      stale.textContent = t.stale;
      children.push(stale);
    }

    if (state.failure !== null) {
      const error = document.createElement('p');
      error.className = 'text-sm text-red-700';
      error.dataset['testid'] = 'capture-error';
      error.setAttribute('role', 'alert');
      error.textContent = t.errors[state.failure];
      children.push(error);
    }

    if (live !== null) {
      const list = document.createElement('dl');
      list.className = 'space-y-1';
      list.append(
        row(t.samples, String(live.samples), 'capture-samples'),
        row(
          t.sampleRate,
          live.sampleRate === null ? t.unavailable : `${live.sampleRate} ${t.hertz}`,
          'capture-sample-rate',
        ),
        row(t.baseLatency, formatMs(live.baseLatency), 'capture-base-latency'),
        row(t.outputLatency, formatMs(live.outputLatency), 'capture-output-latency'),
      );
      children.push(list);
    }

    if (isActive(live)) {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white';
      stop.dataset['testid'] = 'capture-stop';
      stop.textContent = t.stop;
      const sessionId: SessionId = (live as CaptureDiag).sessionId;
      stop.addEventListener('click', () => {
        const message: CaptureMessage = {
          v: 1,
          type: 'CAPTURE_STOP',
          reason: 'USER_STOP',
          sessionId,
          seq: state.stopSeq++,
        };
        void chrome.runtime.sendMessage(message).catch(() => undefined);
      });
      children.push(stop);
    }
    section.replaceChildren(...children);
  };

  const onDiag = (diag: CaptureDiag): void => {
    if (state.ended.has(diag.sessionId)) {
      state.ignored++;
      return;
    }
    const live = state.live;
    if (diag.state === 'failed' && diag.code === 'CAPTURE_BUSY') {
      // A rejected second start must not hide the session that is running,
      // nor count as a sign of life for it.
      state.failure = diag.code;
      render();
      return;
    } else if (live === null || live.sessionId !== diag.sessionId) {
      state.live = diag;
      state.failure = diag.code;
    } else if (diag.seq > live.seq) {
      state.live = diag;
      state.failure = diag.code;
    } else {
      state.ignored++; // out of order or duplicate
      return;
    }
    if (diag.state === 'stopped' || diag.state === 'failed') state.ended.add(diag.sessionId);
    state.liveAt = performance.now();
    render();
  };

  const onLastStart = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (!isSessionId(record['sessionId'])) return;
    const failure = record['failure'];
    state.failure = isCaptureErrorCode(failure) ? failure : null;
    render();
  };

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isOwnExtensionContext(sender)) return false;
    if (isCaptureDiag(message)) onDiag(message);
    return false;
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    const change = changes[LAST_START_KEY];
    if (change !== undefined) onLastStart(change.newValue);
  });
  void chrome.storage.session
    .get(LAST_START_KEY)
    .then((items) => {
      onLastStart(items[LAST_START_KEY]);
    })
    .catch(() => undefined);
  // Re-render once a second so a capture that stopped talking shows as stale.
  let wasStale = false;
  setInterval(() => {
    const stale = isStale();
    if (stale !== wasStale) render();
    wasStale = stale;
  }, 1_000);
  render();
}
