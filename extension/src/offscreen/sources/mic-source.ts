// Microphone source of «La tua voce» (SPEC §2, §5; ADR-0009; I-17).
// The offscreen document cannot show a permission prompt: the first
// authorisation is given in permission.html, a visible extension page, and is
// then the extension origin's. Here the microphone is only opened, never
// asked for. No audio leaves this document (AGENTS.md R1).
import type { CaptureErrorCode } from '@voicecrystal/contracts';

/**
 * Raw input for analysis. Echo cancellation, noise suppression and automatic
 * gain would reshape the signal the descriptors measure (dynamics, spectrum):
 * all off. A device may ignore them; what it applied is not read here.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
};

export type MicOpenResult = { ok: true; stream: MediaStream } | { ok: false; code: CaptureErrorCode };

/** Errors that mean «not allowed»: the permission page is the way out. */
const PERMISSION_ERRORS: readonly string[] = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'];

export function micErrorCode(error: unknown): CaptureErrorCode {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  return PERMISSION_ERRORS.includes(name) ? 'MIC_PERMISSION_REQUIRED' : 'STREAM_NOT_AVAILABLE';
}

/**
 * State of the extension origin's microphone permission, or null when the
 * Permissions API cannot tell (then getUserMedia decides).
 */
export async function micPermissionState(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state;
  } catch {
    return null;
  }
}

/** `permission`: the state read just before, from micPermissionState(). */
export async function openMicStream(permission: PermissionState | null): Promise<MicOpenResult> {
  // A refusal is final: report it at once. 'prompt' still tries (measured in
  // Chromium 156: getUserMedia then fails at once, no hang). The panel checks
  // first, so a normal start reaches here only with 'granted'.
  if (permission === 'denied') return { ok: false, code: 'MIC_PERMISSION_REQUIRED' };
  try {
    return { ok: true, stream: await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS) };
  } catch (error) {
    return { ok: false, code: micErrorCode(error) };
  }
}
