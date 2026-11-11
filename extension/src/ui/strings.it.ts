// Centralised Italian UI strings (AGENTS.md §8, §9). Never inline UI text.
import type { CaptureDiagState, CaptureErrorCode } from '@voicecrystal/contracts';

const captureErrors = {
  NOT_YOUTUBE_WATCH:
    'Questa scheda non è un video di YouTube: apri una pagina youtube.com/watch e clicca di nuovo l’icona.',
  CAPTURE_BUSY: 'C’è già una cattura in corso. Interrompila prima di avviarne un’altra.',
  PERMISSION_DENIED: 'Chrome non ha concesso la cattura di questa scheda.',
  MIC_PERMISSION_REQUIRED: 'Serve l’autorizzazione al microfono.',
  FILE_DECODE_FAILED: 'Il file non si può leggere.',
  FILE_TOO_LONG: 'Il file è troppo lungo.',
  STREAM_ID_EXPIRED: 'L’autorizzazione alla cattura è scaduta: clicca di nuovo l’icona.',
  STREAM_NOT_AVAILABLE: 'L’audio della scheda non è disponibile: clicca di nuovo l’icona.',
  OFFSCREEN_FAILED: 'Non è stato possibile preparare la cattura.',
  AUDIO_CONTEXT_FAILED: 'Non è stato possibile avviare l’elaborazione audio.',
  PROCESSING_OVERRUN: 'L’elaborazione è rimasta indietro.',
  PLAYBACK_ROUTING_FAILED: 'Non è stato possibile riprodurre l’audio della scheda.',
  VIDEO_UNSUPPORTED: 'Questo video non è supportato.',
  INTERNAL_ERROR: 'Errore interno.',
} satisfies Record<CaptureErrorCode, string>;

const captureStates = {
  starting: 'Avvio della cattura…',
  running: 'In ascolto',
  stopped: 'Cattura interrotta',
  failed: 'Cattura non riuscita',
} satisfies Record<CaptureDiagState, string>;

export const strings = {
  appName: 'VoiceCrystal',
  pages: {
    sidepanel: { title: 'VoiceCrystal', heading: 'VoiceCrystal' },
    collection: { title: 'Collezione · VoiceCrystal', heading: 'Collezione' },
    permission: { title: 'Microfono · VoiceCrystal', heading: 'Autorizzazione del microfono' },
  },
  placeholder: 'In costruzione.',
  capture: {
    idle: 'Apri un video su YouTube e clicca l’icona di VoiceCrystal per ascoltarlo.',
    states: captureStates,
    errors: captureErrors,
    stop: 'Interrompi',
    samples: 'Campioni ricevuti',
    sampleRate: 'Frequenza di campionamento',
    baseLatency: 'Latenza di base (stimata)',
    outputLatency: 'Latenza di uscita (stimata)',
    unavailable: 'non disponibile',
    stale: 'Nessun aggiornamento dalla cattura da qualche secondo: potrebbe essersi interrotta.',
    hertz: 'Hz',
    milliseconds: 'ms',
  },
} as const;

export type PageKey = keyof typeof strings.pages;
