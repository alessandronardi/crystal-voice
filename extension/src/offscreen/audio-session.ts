// Offscreen document (SPEC §5, ADR-0001, ADR-0003): owns the stream, the
// AudioContext, the pass-through and the AudioWorklet, and holds the
// authoritative capture state. Only chrome.runtime is available here.
// I-02 PoC: the worklet counts samples, no DSP. Watchdog and capture machine: I-03.
import {
  isOffscreenStartTab,
  isOffscreenStop,
  type CaptureDiag,
  type CaptureDiagState,
  type CaptureErrorCode,
  type OffscreenStartTab,
  type SessionId,
} from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { PCM_PROCESSOR_NAME, type PcmCountMessage } from './pcm-protocol.ts';

const WORKLET_URL = chrome.runtime.getURL('pcm-processor.js');
const DIAG_INTERVAL_MS = 500;

interface Session {
  readonly id: SessionId;
  seq: number;
  samples: number;
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  timer: ReturnType<typeof setInterval> | null;
  stopping: boolean;
}

let session: Session | null = null;

/** Read through a call: the flag changes across awaits, which narrowing ignores. */
function isStopping(s: Session): boolean {
  return s.stopping;
}

function latency(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function emit(s: Session, state: CaptureDiagState, code: CaptureErrorCode | null = null): void {
  const context = s.context;
  const diag: CaptureDiag = {
    v: 1,
    type: 'CAPTURE_DIAG',
    sessionId: s.id,
    seq: s.seq++,
    state,
    samples: s.samples,
    sampleRate: context === null ? null : Math.round(context.sampleRate),
    baseLatency: latency(context?.baseLatency),
    outputLatency: latency(context?.outputLatency),
    code: state === 'failed' ? code : null,
  };
  // No listener (side panel closed) is normal.
  void chrome.runtime.sendMessage(diag).catch(() => undefined);
}

function emitBusy(id: SessionId): void {
  const diag: CaptureDiag = {
    v: 1,
    type: 'CAPTURE_DIAG',
    sessionId: id,
    seq: 0,
    state: 'failed',
    samples: 0,
    sampleRate: null,
    baseLatency: null,
    outputLatency: null,
    code: 'CAPTURE_BUSY',
  };
  void chrome.runtime.sendMessage(diag).catch(() => undefined);
}

/**
 * The single exit (ADR-0004, extension/CLAUDE.md). Idempotent: every release
 * step runs even if an earlier one throws, then the document closes itself
 * (ADR-0003: closed explicitly once resources are released).
 */
async function stopSession(s: Session, failure: CaptureErrorCode | null): Promise<void> {
  if (s.stopping) return;
  s.stopping = true;
  try {
    if (s.timer !== null) clearInterval(s.timer);
    s.timer = null;
    try {
      s.stream?.getTracks().forEach((track) => {
        track.stop();
      });
    } finally {
      try {
        s.worklet?.port.close();
        s.worklet?.disconnect();
        s.source?.disconnect();
      } finally {
        if (s.context !== null && s.context.state !== 'closed') await s.context.close();
      }
    }
  } catch {
    // Release is best effort; the document closing below frees what is left.
  } finally {
    emit(s, failure === null ? 'stopped' : 'failed', failure);
    s.stream = null;
    s.source = null;
    s.worklet = null;
    s.context = null;
    if (session === s) session = null;
    window.close();
  }
}

async function startTab(message: OffscreenStartTab): Promise<void> {
  if (session !== null) {
    emitBusy(message.sessionId);
    return;
  }
  const s: Session = {
    id: message.sessionId,
    seq: 0,
    samples: 0,
    stream: null,
    context: null,
    source: null,
    worklet: null,
    timer: null,
    stopping: false,
  };
  session = s;
  emit(s, 'starting');

  try {
    // Chrome's legacy constraint form is the documented way to use a
    // tabCapture stream ID (tabCapture docs, Chrome 116+).
    const constraints = {
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } },
      video: false,
    } as unknown as MediaStreamConstraints;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (s.stopping) {
      // Stopped while the stream was being opened: release it here.
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return;
    }
    s.stream = stream;
  } catch {
    await stopSession(s, 'STREAM_NOT_AVAILABLE');
    return;
  }

  try {
    s.context = new AudioContext({ latencyHint: 'interactive' });
    await s.context.audioWorklet.addModule(WORKLET_URL);
  } catch {
    await stopSession(s, 'AUDIO_CONTEXT_FAILED');
    return;
  }
  // stopSession may have run during the awaits above (a stop request).
  if (isStopping(s)) return;

  try {
    s.source = s.context.createMediaStreamSource(s.stream);
    // Pass-through: capturing a tab mutes it, so the user hears it from here.
    s.source.connect(s.context.destination);
    // Analysis branch. The worklet has no outputs, so nothing reaches the
    // speakers twice (SPEC §5: no double audio).
    s.worklet = new AudioWorkletNode(s.context, PCM_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    s.worklet.port.onmessage = (event: MessageEvent<PcmCountMessage>) => {
      if (Number.isSafeInteger(event.data.samples)) s.samples = event.data.samples;
    };
    s.source.connect(s.worklet);
    if (s.context.state === 'suspended') await s.context.resume();
  } catch {
    await stopSession(s, 'PLAYBACK_ROUTING_FAILED');
    return;
  }

  for (const track of s.stream.getAudioTracks()) {
    track.addEventListener('ended', () => void stopSession(s, null), { once: true });
  }
  s.timer = setInterval(() => {
    emit(s, 'running');
  }, DIAG_INTERVAL_MS);
  emit(s, 'running');
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  // Commands come only from this extension's own contexts, never a web page.
  if (!isOwnExtensionContext(sender)) return false;
  if (isOffscreenStartTab(message)) {
    void startTab(message);
  } else if (isOffscreenStop(message) && session?.id === message.sessionId) {
    void stopSession(session, null);
  }
  return false;
});
