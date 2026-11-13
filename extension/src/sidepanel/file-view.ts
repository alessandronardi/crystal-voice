// Local-file source in the side panel (I-18, ADR-0022). Diagnostic view: the
// real listening UI is I-13. Flow:
//   choose a file → probe (duration, WAV layout) → choose the start →
//   «Analizza» → CAPTURE_START (source 'file') to the service worker, which
//   applies «one session per profile» (SPEC §5) → decode the window →
//   transfer it to a dsp-worker of this panel → statistics and digests.
// The file's bytes and samples live only inside one analysis and are never
// stored or sent (AGENTS.md R1); the worker is terminated at the end. The
// file name is untrusted text: textContent only (R17). The resulting
// AnalysisSource (SPEC §9) stays in this view's memory: the record that will
// hold the name is the vault's (I-14).
import {
  assertNever,
  isCaptureStopMessage,
  isFileSessionPing,
  isOffscreenStop,
  type AnalysisSource,
  type CaptureErrorCode,
  type CaptureMessage,
  type FileSessionEnd,
  type FileSessionPong,
  type SessionId,
} from '@voicecrystal/contracts';
import { isDspWorkerReply, type AnalyzePcmRequest, type DspWorkerReply } from '../shared/dsp-protocol.ts';
import type { PcmAnalysis } from '../shared/pcm-analysis.ts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { ACTIVE_SESSION_KEY, LAST_START_KEY, isActiveSession, isLastStart } from '../shared/session-storage.ts';
import { strings } from '../ui/strings.it.ts';
import { analysisBlock } from './analysis-rows.ts';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';
import { checkProbe, decodeFileWindow, probeFile, type DecodeRefusal, type FileProbe } from './file-decode.ts';
import { readStartSeconds } from './file-limits.ts';

const t = strings.file;
const WORKER_URL = chrome.runtime.getURL('dsp-worker.js');
/** [H] A start the service worker does not answer within this time is given up. */
const START_ANSWER_TIMEOUT_MS = 15_000;
/**
 * [H] A worker that has not answered within this time is terminated. 120 s of
 * audio take about 2 s in Node (BENCHMARK_PROTOCOL M12); the margin is wide.
 */
const WORKER_TIMEOUT_MS = 60_000;
/**
 * [H] «Interrompi» takes the place of «Analizza» and ignores clicks for this
 * long, so the second click of a double click does not stop the analysis it
 * has just started (review M1).
 */
const STOP_ARM_MS = 500;

type Phase = keyof typeof t.phases;

/**
 * Why an analysis did not give a result: a refusal of the file, a start or
 * analysis error code, or a start point past the end (no session asked for).
 */
type Failure = { kind: 'refusal'; refusal: DecodeRefusal } | { kind: 'code'; code: CaptureErrorCode } | { kind: 'startPastEnd' };

interface FileResult {
  source: AnalysisSource & { kind: 'file' };
  analysis: PcmAnalysis;
  path: 'wav-window' | 'whole';
}

interface ViewState {
  phase: Phase;
  file: File | null;
  probe: (FileProbe & { ok: true }) | null;
  failure: Failure | null;
  result: FileResult | null;
  /** The running analysis, from «Analizza» to its end. */
  sessionId: SessionId | null;
  /** Set to stop the running analysis (Interrompi, CAPTURE_STOP, OFFSCREEN_STOP). */
  abort: (() => void) | null;
  /** performance.now() from which «Interrompi» accepts clicks. */
  stopArmedAt: number;
  seq: number;
}

/** Waits for the service worker's answer to a file start: accepted (activeSession names it) or refused (lastStart). */
function startAnswer(sessionId: SessionId): Promise<CaptureErrorCode | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (failure: CaptureErrorCode | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.storage.session.onChanged.removeListener(onChange);
      resolve(failure);
    };
    const look = (active: unknown, last: unknown): void => {
      if (isActiveSession(active) && active.source === 'file' && active.sessionId === sessionId) finish(null);
      else if (isLastStart(last) && last.sessionId === sessionId && last.failure !== null) finish(last.failure);
    };
    const onChange = (changes: Record<string, chrome.storage.StorageChange>): void => {
      look(changes[ACTIVE_SESSION_KEY]?.newValue, changes[LAST_START_KEY]?.newValue);
    };
    const timer = setTimeout(() => {
      finish('INTERNAL_ERROR');
    }, START_ANSWER_TIMEOUT_MS);
    chrome.storage.session.onChanged.addListener(onChange);
    void chrome.storage.session
      .get([ACTIVE_SESSION_KEY, LAST_START_KEY])
      .then((items) => {
        look(items[ACTIVE_SESSION_KEY], items[LAST_START_KEY]);
      })
      .catch(() => undefined);
  });
}

/**
 * Runs one analysis in a dedicated worker, terminated on every way out: the
 * reply, an error, an unreadable reply, a timeout, a failed post, or a stop.
 */
function runWorker(request: AnalyzePcmRequest, onAbort: (stop: () => void) => void): Promise<DspWorkerReply | null> {
  return new Promise((resolve) => {
    const failed: DspWorkerReply = { type: 'ANALYSIS_FAILED', code: 'INTERNAL' };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_URL, { type: 'module' });
    } catch {
      resolve(failed);
      return;
    }
    let done = false;
    const end = (reply: DspWorkerReply | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(() => {
      end(failed);
    }, WORKER_TIMEOUT_MS);
    onAbort(() => {
      end(null);
    });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      end(isDspWorkerReply(event.data) ? event.data : failed);
    };
    worker.onmessageerror = () => {
      end(failed);
    };
    worker.onerror = () => {
      end(failed);
    };
    try {
      // Transferred, not copied: this panel keeps no reference to the samples.
      worker.postMessage(request, request.channels.map((c) => c.buffer));
    } catch {
      end(failed); // review H1: a failed post must not leave the worker alive
    }
  });
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} ${t.seconds}`;
}

function row(label: string, value: string, testId: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'flex justify-between gap-4 text-sm';
  const term = document.createElement('dt');
  term.className = 'text-slate-600';
  term.textContent = label;
  const def = document.createElement('dd');
  def.className = 'font-mono tabular-nums break-all text-right';
  def.dataset['testid'] = testId;
  def.textContent = value;
  item.append(term, def);
  return item;
}

function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white';
  b.dataset['testid'] = testId;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function failureText(failure: Failure): string {
  switch (failure.kind) {
    case 'refusal':
      return t.refusals[failure.refusal.reason];
    case 'code':
      return t.errors[failure.code];
    case 'startPastEnd':
      return t.startPastEnd;
    default:
      return assertNever(failure);
  }
}

export function mountFileView(root: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'mt-6 space-y-3 border-t border-slate-200 pt-4';
  const heading = document.createElement('h2');
  heading.className = 'text-sm font-semibold';
  heading.textContent = t.heading;
  const note = document.createElement('p');
  note.className = 'text-sm text-slate-600';
  note.textContent = t.note;

  const label = document.createElement('label');
  label.className = 'block text-sm';
  label.textContent = t.choose;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.wav';
  input.className = 'mt-1 block w-full text-sm';
  input.dataset['testid'] = 'file-input';
  label.append(input);

  const startLabel = document.createElement('label');
  startLabel.className = 'block text-sm';
  startLabel.textContent = t.start;
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.min = '0';
  startInput.step = 'any';
  startInput.value = '0';
  startInput.className = 'mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm';
  startInput.dataset['testid'] = 'file-start';
  startLabel.append(startInput);

  const body = document.createElement('div');
  body.className = 'space-y-3';
  section.append(heading, note, label, startLabel, body);
  root.append(section);

  const state: ViewState = {
    phase: 'idle',
    file: null,
    probe: null,
    failure: null,
    result: null,
    sessionId: null,
    abort: null,
    stopArmedAt: 0,
    seq: 0,
  };
  const busy = (): boolean => state.phase === 'probing' || state.phase === 'starting' || state.phase === 'decoding' || state.phase === 'analyzing';

  const render = (): void => {
    input.disabled = busy();
    startInput.disabled = busy() || state.probe === null;
    if (state.probe !== null) startInput.max = String(state.probe.durationSeconds);
    const children: HTMLElement[] = [];
    const status = document.createElement('p');
    status.className = 'text-sm font-medium';
    status.dataset['testid'] = 'file-status';
    status.dataset['phase'] = state.phase;
    status.textContent = t.phases[state.phase];
    children.push(status);
    if (state.failure !== null) {
      const error = document.createElement('p');
      error.className = 'text-sm text-red-700';
      error.setAttribute('role', 'alert');
      error.dataset['testid'] = 'file-error';
      const f = state.failure;
      error.dataset['code'] = f.kind === 'refusal' ? f.refusal.code : f.kind === 'code' ? f.code : '';
      error.dataset['reason'] = f.kind === 'refusal' ? f.refusal.reason : f.kind === 'startPastEnd' ? 'START_PAST_END' : '';
      error.textContent = failureText(state.failure);
      children.push(error);
    }
    const list = document.createElement('dl');
    list.className = 'space-y-1';
    if (state.file !== null) list.append(row(t.name, state.file.name, 'file-name'));
    if (state.probe !== null) list.append(row(t.duration, formatSeconds(state.probe.durationSeconds), 'file-duration'));
    const result = state.result;
    if (result !== null) {
      const a = result.analysis;
      list.append(
        row(t.window, `${formatSeconds(result.source.offsetStartSeconds)} ${t.to} ${formatSeconds(result.source.offsetEndSeconds)}`, 'file-window'),
        row(t.sourceRate, `${a.sourceSampleRate} ${t.hertz}`, 'file-source-rate'),
        row(t.channels, String(a.channelCount), 'file-channels'),
        row(t.monoRule, a.mono.rule, 'file-mono-rule'),
        row(t.analysisSamples, String(a.analysis.length), 'file-analysis-samples'),
        row(t.pitchFrames, `${a.pitch.voicedFrames} / ${a.pitch.frames}`, 'file-pitch-frames'),
        row(t.medianF0, a.pitch.medianF0Hz === null ? t.unavailable : `${a.pitch.medianF0Hz.toFixed(1)} ${t.hertz}`, 'file-median-f0'),
      );
      const digest = row(t.digest, a.analysis.sha256.slice(0, 16), 'file-digest');
      // Full values for the E2E comparison with the Node harness; numbers, not samples.
      const dd = digest.querySelector('dd');
      if (dd !== null) dd.dataset['analysis'] = JSON.stringify({ source: result.source, analysis: a, path: result.path });
      list.append(digest);
    }
    if (list.childElementCount > 0) children.push(list);
    if (result !== null) {
      const d = result.analysis.descriptors;
      // D-AA (2026-11-13): the same rule as the tab and the microphone (SPEC §6.1),
      // a crystal only with at least 8 s of valid speech.
      const ready = d.status === 'OK' && d.seed !== null && d.quality.accepted && d.quality.validSpeechMs >= CAPTURE_LIMITS.minValidSpeechMs;
      children.push(
        analysisBlock(
          {
            status: ready ? 'OK' : 'INSUFFICIENT_DATA',
            seed: ready ? d.seed : null,
            warnings: d.warnings,
            missingFeatureKeys: d.missingFeatureKeys,
            veiledKeys: d.veiledKeys,
            validSpeechMs: d.quality.validSpeechMs,
            analysedMs: null,
            failure: null,
          },
          'file',
        ),
      );
    }
    if (state.phase === 'ready' || state.phase === 'done' || state.phase === 'failed' || state.phase === 'stopped') {
      if (state.probe !== null) {
        children.push(
          button(t.analyze, 'file-analyze', () => {
            void analyze();
          }),
        );
      }
    } else if (state.phase === 'decoding' || state.phase === 'analyzing' || state.phase === 'starting') {
      const stop = button(t.stop, 'file-stop', () => {
        if (performance.now() >= state.stopArmedAt) state.abort?.();
      });
      const wait = state.stopArmedAt - performance.now();
      if (wait > 0) {
        stop.disabled = true;
        stop.dataset['armed'] = 'false';
        setTimeout(() => {
          stop.disabled = false;
          stop.dataset['armed'] = 'true';
        }, wait);
      } else {
        stop.dataset['armed'] = 'true';
      }
      children.push(stop);
    }
    body.replaceChildren(...children);
  };

  const onFileChosen = async (): Promise<void> => {
    const file = input.files?.[0] ?? null;
    if (busy()) return;
    state.file = file;
    state.probe = null;
    state.result = null;
    state.failure = null;
    startInput.value = '0';
    if (file === null) {
      state.phase = 'idle';
      render();
      return;
    }
    state.phase = 'probing';
    render();
    const probe = await probeFile(file);
    if (state.file !== file) return; // another file was chosen meanwhile
    if (!probe.ok) {
      state.phase = 'failed';
      state.failure = { kind: 'refusal', refusal: probe };
      render();
      return;
    }
    // Refused files are refused before «Analizza», which is then not offered:
    // no session is asked for. The check uses start 0; a later start could
    // only shorten the window at the end of a WAV, a case not offered.
    const refusal = checkProbe(probe, file.size, 0);
    state.probe = refusal === null ? probe : null;
    state.phase = refusal === null ? 'ready' : 'failed';
    state.failure = refusal === null ? null : { kind: 'refusal', refusal };
    render();
  };

  const analyze = async (): Promise<void> => {
    const file = state.file;
    const probe = state.probe;
    if (busy() || file === null || probe === null) return;
    const startSeconds = readStartSeconds(Number(startInput.value));
    // A start point past the end analyses nothing: say so, ask for no session (review L2).
    if (startSeconds >= probe.durationSeconds) {
      state.failure = { kind: 'startPastEnd' };
      render();
      return;
    }
    // Pending from the click on, before any await: a double click cannot start twice.
    const sessionId = crypto.randomUUID();
    state.sessionId = sessionId;
    state.phase = 'starting';
    state.failure = null;
    state.result = null;
    state.stopArmedAt = performance.now() + STOP_ARM_MS;
    const run = { over: false, accepted: false };
    // A function, not the field: the field's narrowing would survive the awaits.
    const isOver = (): boolean => run.over;
    let stopWorker: (() => void) | null = null;
    const sendEnd = (): void => {
      const end: FileSessionEnd = { v: 1, type: 'FILE_SESSION_END', sessionId };
      void chrome.runtime.sendMessage(end).catch(() => undefined);
    };
    /**
     * Ends this analysis at once, whatever is still pending: a stop is shown
     * immediately, the panel stops answering the ping, the routing state is
     * released, and whatever arrives later is ignored (review M2).
     */
    const finish = (phase: Phase, failure: Failure | null, result: FileResult | null = null): void => {
      if (run.over) return;
      run.over = true;
      stopWorker?.();
      state.phase = phase;
      state.failure = failure;
      state.result = result;
      if (run.accepted) sendEnd();
      state.sessionId = null;
      state.abort = null;
      render();
    };
    state.abort = () => {
      finish('stopped', null);
    };
    render();
    try {
      const refusal = checkProbe(probe, file.size, startSeconds);
      if (refusal !== null) {
        finish('failed', { kind: 'refusal', refusal });
        return;
      }
      const message: CaptureMessage = { v: 1, type: 'CAPTURE_START', source: 'file', tabId: null, sessionId, seq: state.seq++ };
      const answer = startAnswer(sessionId);
      void chrome.runtime.sendMessage(message).catch(() => undefined);
      const failure = await answer;
      if (failure === null) {
        run.accepted = true;
        // Stopped while waiting for the answer: release the session just granted.
        if (isOver()) sendEnd();
      }
      if (isOver()) return;
      if (failure !== null) {
        finish('failed', { kind: 'code', code: failure });
        return;
      }
      state.phase = 'decoding';
      render();
      const outcome = await decodeFileWindow(file, probe, startSeconds);
      if (isOver()) return;
      if (!outcome.ok) {
        finish('failed', { kind: 'refusal', refusal: outcome });
        return;
      }
      const { decoded } = outcome;
      state.phase = 'analyzing';
      render();
      const request: AnalyzePcmRequest = { type: 'ANALYZE_PCM', sampleRate: decoded.sampleRate, channels: decoded.channels };
      const reply = await runWorker(request, (stop) => {
        stopWorker = stop;
      });
      if (isOver() || reply === null) return;
      if (reply.type === 'STREAM_RESULT') {
        // Not an answer to ANALYZE_PCM: this worker is ours, so it is a bug, never a result.
        finish('failed', { kind: 'code', code: 'INTERNAL_ERROR' });
        return;
      }
      if (reply.type === 'ANALYSIS_FAILED') {
        const decodeLike = reply.code === 'UNSUPPORTED_RATE' || reply.code === 'BAD_SAMPLE_RATE' || reply.code === 'NON_FINITE_INPUT';
        finish(
          'failed',
          decodeLike ? { kind: 'refusal', refusal: { code: 'FILE_DECODE_FAILED', reason: 'DECODE' } } : { kind: 'code', code: 'INTERNAL_ERROR' },
        );
        return;
      }
      finish('done', null, {
        source: {
          kind: 'file',
          fileName: file.name,
          durationSeconds: decoded.durationSeconds,
          offsetStartSeconds: decoded.offsetStartSeconds,
          offsetEndSeconds: decoded.offsetEndSeconds,
        },
        analysis: reply.analysis,
        path: decoded.path,
      });
    } catch {
      // Anything unexpected (an allocation that fails, a context that went
      // away): the panel must not stay stuck in a busy phase (review H1).
      finish('failed', { kind: 'code', code: 'INTERNAL_ERROR' });
    }
  };

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isOwnExtensionContext(sender)) return false;
    const id = state.sessionId;
    if (id === null) return false;
    if (isFileSessionPing(message) && message.sessionId === id) {
      // The service worker asks whether this session still runs (ADR-0022):
      // only the panel running it answers.
      const pong: FileSessionPong = { v: 1, type: 'FILE_SESSION_PONG', sessionId: id };
      sendResponse(pong);
    } else if ((isCaptureStopMessage(message) || isOffscreenStop(message)) && message.sessionId === id) {
      // «Interrompi la cattura in corso» from any panel (CAPTURE_STOP, or the
      // service worker's OFFSCREEN_STOP that follows it) stops this analysis.
      state.abort?.();
    }
    return false;
  });

  input.addEventListener('change', () => {
    void onFileChosen();
  });
  render();
}
