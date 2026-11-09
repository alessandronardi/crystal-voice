// Messages between extension contexts. Transcribed literally from SPEC v0.3 §9.
// Any semantic change here needs a spec/ADR change first (AGENTS.md §2, §10).

import type { CrystalSeed, DescriptorKey, SeedConfidence } from './seed.ts';

/** UUID v4. */
export type SessionId = string;

export type SourceKind = 'tab' | 'mic' | 'file';

/** Capture machine states only (SPEC §6.1). */
export type CaptureState =
  | 'IDLE'
  | 'AUTHORIZING'
  | 'LISTENING'
  | 'WAITING_FOR_SPEECH'
  | 'PAUSED'
  | 'FINALIZING'
  | 'RESULT_READY'
  | 'INSUFFICIENT_DATA'
  | 'INTERRUPTED'
  | 'ERROR';

export type CaptureExitReason =
  | 'CONVERGED'
  | 'MAX_VALID_SPEECH'
  | 'WALL_TIMEOUT'
  | 'ABSOLUTE_TIMEOUT'
  | 'USER_STOP'
  | 'VIDEO_SEEK'
  | 'VIDEO_CHANGED'
  | 'PLAYBACK_RATE_CHANGED'
  | 'AD_OR_SOURCE_CHANGE'
  | 'NAVIGATED_AWAY'
  | 'MULTI_SPEAKER_DECLINED'
  | 'STREAM_ENDED'
  | 'OFFSCREEN_CLOSED'
  | 'QUALITY_REJECTED'
  | 'CAPTURE_ERROR';

export type QualityWarning =
  | 'MIXED_AUDIO_UNCERTAIN'
  | 'MULTI_SPEAKER_SUSPECTED'
  | 'LOW_CONFIDENCE_PARAMETER'
  | 'CLIPPING'
  | 'LOW_LEVEL'
  | 'PLAYER_MUTED'
  | 'EXPERIMENTAL_MAPPING';

/** `seq` is strictly increasing per sender. */
export interface Envelope {
  v: 1;
  sessionId: SessionId;
  seq: number;
}

export type CaptureErrorCode =
  | 'NOT_YOUTUBE_WATCH'
  | 'CAPTURE_BUSY'
  | 'PERMISSION_DENIED'
  | 'MIC_PERMISSION_REQUIRED'
  | 'FILE_DECODE_FAILED'
  | 'FILE_TOO_LONG'
  | 'STREAM_ID_EXPIRED'
  | 'STREAM_NOT_AVAILABLE'
  | 'OFFSCREEN_FAILED'
  | 'AUDIO_CONTEXT_FAILED'
  | 'PROCESSING_OVERRUN'
  | 'PLAYBACK_ROUTING_FAILED'
  | 'VIDEO_UNSUPPORTED'
  | 'INTERNAL_ERROR';

export interface QualitySummary {
  accepted: boolean;
  validSpeechMs: number;
  pitchUsableFrames: number;
  vadSpeechFrames: number;
  droppedFrames: number;
  clippedFraction: number;
  confidence: SeedConfidence;
  missingFeatureKeys: DescriptorKey[];
  warnings: QualityWarning[];
}

export type AnalysisSource =
  | {
      kind: 'tab';
      platform: 'youtube';
      videoId: string;
      title: string;
      timeStartSeconds: number | null;
      timeEndSeconds: number | null;
      timelineQuality: 'estimated' | 'unknown';
      playbackRate: 1;
    }
  | { kind: 'mic' }
  | {
      kind: 'file';
      fileName: string;
      durationSeconds: number;
      offsetStartSeconds: number;
      offsetEndSeconds: number;
    };

export interface AnalysisResult {
  seed: CrystalSeed;
  confidence: SeedConfidence;
  /** Raw measures x_i, for the live legend. */
  rawMeasures: readonly [number, number, number, number, number, number];
  extractorVersion: string;
  mappingVersion: string;
  /** Generator the UI will display it with. */
  geometryVersion: string;
  comparatorVersion: string;
  exitReason: CaptureExitReason;
  quality: QualitySummary;
  source: AnalysisSource;
}

export type CaptureMessage = Envelope &
  (
    | { type: 'CAPTURE_START'; source: SourceKind; tabId: number | null }
    | { type: 'CAPTURE_STOP'; reason: 'USER_STOP' }
    | {
        type: 'HEARTBEAT';
        videoId: string;
        url: string;
        paused: boolean;
        playbackRate: number;
        muted: boolean;
        volume: number;
      }
    | { type: 'MULTI_SPEAKER_ANSWER'; singleSpeaker: boolean }
    | {
        type: 'CAPTURE_PROGRESS';
        state: CaptureState;
        validSpeechMs: number;
        elapsedMs: number;
        quality: QualitySummary;
        /** Only for the growing seed crystal; labelled «provvisorio» in the UI. */
        provisionalSeed: CrystalSeed | null;
      }
    | { type: 'CAPTURE_RESULT'; result: AnalysisResult }
    | { type: 'CAPTURE_FAILED'; code: CaptureErrorCode; exitReason: CaptureExitReason }
  );

export type CaptureMessageType = CaptureMessage['type'];
