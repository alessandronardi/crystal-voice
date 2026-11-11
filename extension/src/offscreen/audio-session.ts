// Offscreen document (SPEC §5, ADR-0001, ADR-0003): owns the stream, the
// AudioContext, the pass-through and the AudioWorklet. The authoritative
// capture state lives in CaptureSession (capture machine + watchdog); this
// file only wires it to chrome.runtime and WebAudio. Only chrome.runtime is
// available here. The worklet counts samples; no DSP before I-05/I-06.
import {
  isHeartbeatMessage,
  isOffscreenStartTab,
  isOffscreenStop,
  isPlayerEvent,
  type CaptureDiag,
  type HeartbeatReply,
  type OffscreenStartTab,
} from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { CaptureSession, type AudioFacts } from './capture-session.ts';
import { PCM_PROCESSOR_NAME, type PcmCountMessage } from './pcm-protocol.ts';

const WORKLET_URL = chrome.runtime.getURL('pcm-processor.js');
const TICK_INTERVAL_MS = 500;
/** [H] Time to wait for the service worker's reason after a track ends. */
const STREAM_ENDED_GRACE_MS = 500;

interface AudioGraph {
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  ticker: ReturnType<typeof setInterval> | null;
}

/** The one session of this document (one capture per profile, SPEC §5). */
let current: { session: CaptureSession; graph: AudioGraph } | null = null;

function send(diag: CaptureDiag): void {
  // No listener (side panel closed) is normal.
  void chrome.runtime.sendMessage(diag).catch(() => undefined);
}

function latency(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Releases every resource; each step runs even if an earlier one throws. */
async function releaseGraph(graph: AudioGraph): Promise<void> {
  if (graph.ticker !== null) clearInterval(graph.ticker);
  graph.ticker = null;
  try {
    graph.stream?.getTracks().forEach((track) => {
      track.stop();
    });
  } catch {
    // Continue with the nodes.
  }
  try {
    if (graph.worklet !== null) {
      graph.worklet.port.onmessage = null;
      graph.worklet.port.close();
      graph.worklet.disconnect();
    }
    graph.source?.disconnect();
  } catch {
    // Continue with the context.
  }
  try {
    if (graph.context !== null && graph.context.state !== 'closed') await graph.context.close();
  } catch {
    // Closing the document frees what is left.
  }
  graph.stream = null;
  graph.source = null;
  graph.worklet = null;
  graph.context = null;
}

/** A start refused because a session exists: its own short ERROR, the running one untouched. */
function refuseBusy(message: OffscreenStartTab): void {
  send({
    v: 1,
    type: 'CAPTURE_DIAG',
    sessionId: message.sessionId,
    seq: 0,
    state: 'ERROR',
    exitReason: 'CAPTURE_ERROR',
    code: 'CAPTURE_BUSY',
    samples: 0,
    sampleRate: null,
    elapsedMs: 0,
    activeMs: 0,
    baseLatency: null,
    outputLatency: null,
  });
}

async function startTab(message: OffscreenStartTab): Promise<void> {
  if (current !== null) {
    refuseBusy(message);
    return;
  }
  const graph: AudioGraph = { stream: null, context: null, source: null, worklet: null, ticker: null };
  const session = new CaptureSession(message.sessionId, message.tabId, {
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    emit: send,
    release: () => releaseGraph(graph),
    onIdle: () => {
      if (current?.session === session) current = null;
      // ADR-0003: the document is closed explicitly once resources are released.
      window.close();
    },
  });
  current = { session, graph };

  let stream: MediaStream;
  try {
    // Chrome's legacy constraint form is the documented way to use a
    // tabCapture stream ID (tabCapture docs, Chrome 116+).
    const constraints = {
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } },
      video: false,
    } as unknown as MediaStreamConstraints;
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    session.denied('STREAM_NOT_AVAILABLE');
    return;
  }
  graph.stream = stream;
  if (!session.isLive()) {
    // Stopped while the stream was being opened.
    await releaseGraph(graph);
    return;
  }

  try {
    graph.context = new AudioContext({ latencyHint: 'interactive' });
    await graph.context.audioWorklet.addModule(WORKLET_URL);
    graph.source = graph.context.createMediaStreamSource(stream);
    // Pass-through: capturing a tab mutes it, so the user hears it from here.
    graph.source.connect(graph.context.destination);
    // Analysis branch. The worklet has no outputs, so nothing reaches the
    // speakers twice (SPEC §5: no double audio).
    graph.worklet = new AudioWorkletNode(graph.context, PCM_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    graph.worklet.port.onmessage = (event: MessageEvent<PcmCountMessage>) => {
      session.onSamples(event.data.samples);
    };
    graph.source.connect(graph.worklet);
    if (graph.context.state === 'suspended') await graph.context.resume();
  } catch {
    session.fail('CAPTURE_ERROR', graph.context === null ? 'AUDIO_CONTEXT_FAILED' : 'PLAYBACK_ROUTING_FAILED');
    return;
  }
  if (!session.isLive()) return;

  for (const track of stream.getAudioTracks()) {
    track.addEventListener(
      'ended',
      () => {
        // The track also ends when the tab closes or navigates; the service
        // worker's reason (NAVIGATED_AWAY) usually follows within milliseconds.
        // Wait for it briefly so a closed tab is not reported as an error.
        setTimeout(() => {
          session.stop('STREAM_ENDED');
        }, STREAM_ENDED_GRACE_MS);
      },
      { once: true },
    );
  }
  const facts: AudioFacts = {
    sampleRate: Math.round(graph.context.sampleRate),
    baseLatency: latency(graph.context.baseLatency),
    outputLatency: latency(graph.context.outputLatency),
  };
  session.acquired(facts);
  graph.ticker = setInterval(() => {
    session.tick();
  }, TICK_INTERVAL_MS);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // From the content script of a tab: heartbeat and player events only.
  if (sender.tab !== undefined && !isOwnExtensionContext(sender)) {
    if (sender.id !== chrome.runtime.id) return false;
    const session = current?.session;
    if (isHeartbeatMessage(message)) {
      const reply: HeartbeatReply = { active: session?.onHeartbeat(message, sender.tab.id) ?? false };
      sendResponse(reply);
    } else if (isPlayerEvent(message)) {
      const reply: HeartbeatReply = { active: session?.onPlayerEvent(message, sender.tab.id) ?? false };
      sendResponse(reply);
    }
    return false;
  }
  // Commands come only from this extension's own contexts.
  if (!isOwnExtensionContext(sender)) return false;
  if (isOffscreenStartTab(message)) {
    void startTab(message);
  } else if (isOffscreenStop(message) && current?.session.id === message.sessionId) {
    current.session.stop(message.reason);
  }
  return false;
});
