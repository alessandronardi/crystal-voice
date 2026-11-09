// Diagnostic messages. NOT part of SPEC §9 `CaptureMessage`: they carry no
// session, no audio and no user data, and exist only so tests can check that
// the service worker is alive (I-01 DoD: "the service worker answers a ping").

export interface PingMessage {
  v: 1;
  type: 'PING';
  /** Echoed back so the caller can match the reply. */
  nonce: string;
}

export interface PongMessage {
  v: 1;
  type: 'PONG';
  nonce: string;
  /** `version` field of the loaded manifest. */
  extensionVersion: string;
}

export type DiagnosticMessage = PingMessage | PongMessage;

const MAX_NONCE_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Guard for untrusted input received by `chrome.runtime.onMessage`. */
export function isPingMessage(value: unknown): value is PingMessage {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'PING' &&
    typeof value['nonce'] === 'string' &&
    value['nonce'].length > 0 &&
    value['nonce'].length <= MAX_NONCE_LENGTH
  );
}

export function isPongMessage(value: unknown): value is PongMessage {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'PONG' &&
    typeof value['nonce'] === 'string' &&
    typeof value['extensionVersion'] === 'string'
  );
}

export function makePong(ping: PingMessage, extensionVersion: string): PongMessage {
  return { v: 1, type: 'PONG', nonce: ping.nonce, extensionVersion };
}
