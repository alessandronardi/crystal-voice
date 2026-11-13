// Offscreen document (SPEC §5, ADR-0001, ADR-0003): owns the stream, the
// AudioContext, the pass-through and the AudioWorklet. The authoritative
// capture state lives in CaptureSession (capture machine + watchdog); this
// file only wires it to chrome.runtime and WebAudio. Only chrome.runtime is
// available here. The worklet counts samples and, since I-06b (ADR-0025),
// forwards the audio of the listening states to a DSP worker of this
// document, which analyses it once in FINALIZING. I-07 (ADR-0026): the worker
// also evaluates the audio so far once per second (STREAM_PROGRESS), which
// drives MAX_VALID_SPEECH and the split-half stop.
// Two sources: the tab (stream ID from tabCapture, played back) and the
// microphone (I-17: no playback, kept alive by the side panel's port).
import {
  isHeartbeatMessage,
  isOffscreenStartMic,
  isOffscreenStartTab,
  isOffscreenStop,
  isPlayerEvent,
  panelPortSessionId,
  type CaptureDiag,
  type HeartbeatReply,
  type CaptureAnalysis,
  type OffscreenStartTab,
  type SessionId,
} from '@voicecrystal/contracts';
import { isDspWorkerReply, type DspWorkerReply, type StreamBeginRequest } from '../shared/dsp-protocol.ts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { CaptureSession, type AudioFacts, type SessionAnalysis, type SessionBinding } from './capture-session.ts';
import { PCM_PROCESSOR_NAME, type PcmCountMessage, type WorkletCommand } from './pcm-protocol.ts';
import { micPermissionState, openMicStream } from './sources/mic-source.ts';

const WORKLET_URL = chrome.runtime.getURL('pcm-processor.js');
const DSP_WORKER_URL = chrome.runtime.getURL('dsp-worker.js');
const TICK_INTERVAL_MS = 500;
/** [H] Time to wait for the service worker's reason after a tab track ends. */
const STREAM_ENDED_GRACE_MS = 500;

interface AudioGraph {
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  ticker: ReturnType<typeof setInterval> | null;
  /** I-06b: the DSP worker that keeps and analyses the audio of this session. */
  worker: Worker | null;
  sampleRate: number | null;
  /** Review M-4: a worker failure seen before FINALIZING, reported at the end instead of a timeout. */
  workerFailure: NonNullable<CaptureAnalysis['failure']> | null;
}

/**
 * Review C-1 (R8): FINALIZING captures nothing. The tracks stop (the browser's
 * capture indicator goes off) and the source is disconnected; the context
 * and the worklet stay so that END and the last block still reach the worker.
 */
function endCapture(graph: AudioGraph): void {
  try {
    graph.stream?.getTracks().forEach((track) => {
      track.stop();
    });
  } catch {
    // Release stops them again.
  }
  try {
    graph.source?.disconnect();
  } catch {
    // Already disconnected.
  }
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
  // The worker holds the session's audio (R1: RAM only): it goes first.
  try {
    graph.worker?.terminate();
  } catch {
    // Continue with the tracks.
  }
  graph.worker = null;
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
function refuseBusy(sessionId: SessionId): void {
  send({
    v: 1,
    type: 'CAPTURE_DIAG',
    sessionId,
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
    analysis: null,
    validSpeechMs: 0,
    stability: null,
  });
}

function command(graph: AudioGraph, message: WorkletCommand): void {
  try {
    graph.worklet?.port.postMessage(message);
  } catch {
    // A closed worklet has nothing more to send; the analysis times out.
  }
}

const failed = (failure: NonNullable<CaptureAnalysis['failure']>): SessionAnalysis => ({
  analysis: { quality: null, seed: null, extractorVersion: null, mappingVersion: null, failure, analysedMs: null },
  accepted: false,
  validSpeechMs: 0,
});

/** STREAM_RESULT → what FINALIZING decides (I-06b). Never rejects. */
function toSessionAnalysis(reply: DspWorkerReply, sampleRate: number | null): SessionAnalysis {
  if (reply.type !== 'STREAM_RESULT') return failed('ANALYSIS_FAILED');
  const a = reply.analysis;
  if (reply.failure !== null || a === null) return failed(reply.failure === 'VAD_UNAVAILABLE' ? 'VAD_UNAVAILABLE' : 'ANALYSIS_FAILED');
  // Refused samples, as 10 ms frames like pitchUsableFrames (droppedFrames of SPEC §9).
  const dropped = sampleRate === null ? 0 : Math.ceil((reply.stats.droppedFrames * 100) / sampleRate);
  const quality = { ...a.quality, droppedFrames: dropped };
  return {
    analysis: {
      quality,
      seed: a.seed,
      extractorVersion: a.extractorVersion,
      mappingVersion: a.mappingVersion,
      failure: null,
      analysedMs: sampleRate === null ? null : Math.round((reply.stats.frames * 1000) / sampleRate),
    },
    accepted: quality.accepted && a.seed !== null,
    validSpeechMs: quality.validSpeechMs,
  };
}

/** Asks the worker for the analysis: END goes through the worklet, after its last block. */
function finalizeGraph(graph: AudioGraph): Promise<SessionAnalysis> {
  const worker = graph.worker;
  if (graph.workerFailure !== null) return Promise.resolve(failed(graph.workerFailure));
  if (worker === null || graph.worklet === null) return Promise.resolve(failed('ANALYSIS_FAILED'));
  return new Promise<SessionAnalysis>((resolve) => {
    worker.onmessage = (event: MessageEvent<unknown>) => {
      // An evaluation that finished just before END is late, not the answer (I-07).
      if (isDspWorkerReply(event.data) && event.data.type === 'STREAM_PROGRESS') return;
      resolve(isDspWorkerReply(event.data) ? toSessionAnalysis(event.data, graph.sampleRate) : failed('ANALYSIS_FAILED'));
    };
    worker.onerror = () => {
      resolve(failed('ANALYSIS_FAILED'));
    };
    worker.onmessageerror = () => {
      resolve(failed('ANALYSIS_FAILED'));
    };
    command(graph, { type: 'END' });
  });
}

/** Creates the session of this document, or refuses with CAPTURE_BUSY. */
function openSession(sessionId: SessionId, binding: SessionBinding): { session: CaptureSession; graph: AudioGraph } | null {
  if (current !== null) {
    refuseBusy(sessionId);
    return null;
  }
  const graph: AudioGraph = {
    stream: null,
    context: null,
    source: null,
    worklet: null,
    ticker: null,
    worker: null,
    sampleRate: null,
    workerFailure: null,
  };
  const session = new CaptureSession(sessionId, binding, {
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    emit: send,
    release: () => releaseGraph(graph),
    finalize: () => finalizeGraph(graph),
    setRecording: (record) => {
      command(graph, { type: 'RECORD', record });
    },
    endCapture: () => {
      endCapture(graph);
    },
    onIdle: () => {
      if (current?.session === session) current = null;
      // ADR-0003: the document is closed explicitly once resources are released.
      window.close();
    },
  });
  current = { session, graph };
  return current;
}

/**
 * Wires an open stream: AudioContext, counting worklet, optional pass-through.
 * The tab needs the pass-through (capturing it mutes it); the microphone must
 * not have one (BACKLOG I-17: no feedback to the speakers).
 */
async function runGraph(session: CaptureSession, graph: AudioGraph, stream: MediaStream, passThrough: boolean): Promise<void> {
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
    if (passThrough) graph.source.connect(graph.context.destination);
    // Analysis branch. The worklet has no outputs, so nothing reaches the
    // speakers twice (SPEC §5: no double audio), and nothing at all for the
    // microphone.
    graph.worklet = new AudioWorkletNode(graph.context, PCM_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    graph.worklet.port.onmessage = (event: MessageEvent<PcmCountMessage>) => {
      session.onSamples(event.data.samples);
    };
    // I-06b: one DSP worker per session; the worklet talks to it on its own channel.
    graph.sampleRate = Math.round(graph.context.sampleRate);
    graph.worker = new Worker(DSP_WORKER_URL, { type: 'module' });
    // Review M-4: a worker that fails to load or refuses STREAM_BEGIN is known at once;
    // finalizeGraph replaces these handlers with the ones waiting for STREAM_RESULT.
    graph.worker.onerror = () => {
      graph.workerFailure = 'ANALYSIS_FAILED';
    };
    graph.worker.onmessage = (event: MessageEvent<unknown>) => {
      const reply = event.data;
      if (!isDspWorkerReply(reply)) return;
      if (reply.type === 'ANALYSIS_FAILED') {
        graph.workerFailure = reply.code === 'VAD_UNAVAILABLE' ? 'VAD_UNAVAILABLE' : 'ANALYSIS_FAILED';
      } else if (reply.type === 'STREAM_PROGRESS') {
        session.onProgress(reply.progress);
      }
    };
    const channel = new MessageChannel();
    const begin: StreamBeginRequest = { type: 'STREAM_BEGIN', sampleRate: graph.sampleRate, port: channel.port2 };
    graph.worker.postMessage(begin, [channel.port2]);
    graph.worklet.port.postMessage({ type: 'ATTACH_WORKER', port: channel.port1 } satisfies WorkletCommand, [channel.port1]);
    graph.source.connect(graph.worklet);
    if (graph.context.state === 'suspended') await graph.context.resume();
  } catch {
    const code = graph.context === null || !passThrough ? 'AUDIO_CONTEXT_FAILED' : 'PLAYBACK_ROUTING_FAILED';
    session.fail('CAPTURE_ERROR', code);
    return;
  }
  if (!session.isLive()) return;

  const onEnded = (): void => {
    if (!passThrough) {
      // A microphone track ends when the device goes away or the grant is
      // revoked: nothing else to wait for.
      session.stop('STREAM_ENDED');
      return;
    }
    // The track also ends when the tab closes or navigates; the service
    // worker's reason (NAVIGATED_AWAY) usually follows within milliseconds.
    // Wait for it briefly so a closed tab is not reported as an error.
    setTimeout(() => {
      session.stop('STREAM_ENDED');
    }, STREAM_ENDED_GRACE_MS);
  };
  const tracks = stream.getAudioTracks();
  for (const track of tracks) track.addEventListener('ended', onEnded, { once: true });
  // A track that ended while the graph was being built fired no event here (review M-3).
  if (tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) {
    onEnded();
    return;
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

async function startTab(message: OffscreenStartTab): Promise<void> {
  const opened = openSession(message.sessionId, { source: 'tab', tabId: message.tabId });
  if (opened === null) return;
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
    opened.session.denied('STREAM_NOT_AVAILABLE');
    return;
  }
  await runGraph(opened.session, opened.graph, stream, true);
}

async function startMic(sessionId: SessionId): Promise<void> {
  const opened = openSession(sessionId, { source: 'mic' });
  if (opened === null) return;
  const permission = await micPermissionState();
  // With a grant, a microphone that never opens is a device problem, not a
  // missing permission (review L-1).
  if (permission === 'granted') opened.session.setAuthorizingTimeoutCode('STREAM_NOT_AVAILABLE');
  const result = await openMicStream(permission);
  if (!result.ok) {
    opened.session.denied(result.code);
    return;
  }
  await runGraph(opened.session, opened.graph, result.stream, false);
}

// The side panel's port for a microphone session (I-17): the session lasts
// as long as the port. Ports from anything but this extension's pages, for
// another session, or a second one, are closed at once.
chrome.runtime.onConnect.addListener((port) => {
  const sessionId = panelPortSessionId(port.name);
  if (sessionId === null) return;
  const session = current?.session;
  const sender = port.sender;
  if (sender === undefined || !isOwnExtensionContext(sender) || session?.id !== sessionId || !session.attachPanel()) {
    port.disconnect();
    return;
  }
  port.onDisconnect.addListener(() => {
    session.detachPanel();
  });
});

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
  } else if (isOffscreenStartMic(message)) {
    void startMic(message.sessionId);
  } else if (isOffscreenStop(message) && current?.session.id === message.sessionId) {
    current.session.stop(message.reason);
  }
  return false;
});
