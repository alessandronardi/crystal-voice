// Centralised Italian UI strings (AGENTS.md §8, §9). Never inline UI text.
import type { CaptureErrorCode, CaptureExitReason, CaptureState } from '@voicecrystal/contracts';

const captureErrors = {
  NOT_YOUTUBE_WATCH:
    'Questa scheda non è un video di YouTube: apri una pagina youtube.com/watch e clicca di nuovo l’icona.',
  CAPTURE_BUSY: 'C’è già una cattura in corso, forse in un’altra scheda. Interrompila per avviarne una nuova.',
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
  IDLE: 'Nessuna cattura in corso',
  AUTHORIZING: 'Avvio della cattura…',
  LISTENING: 'In ascolto',
  WAITING_FOR_SPEECH: 'In attesa di voce',
  PAUSED: 'In pausa',
  FINALIZING: 'Analisi conclusiva…',
  RESULT_READY: 'Risultato pronto',
  INSUFFICIENT_DATA: 'Risultato non sufficiente',
  INTERRUPTED: 'Cattura interrotta',
  ERROR: 'Cattura non riuscita',
} satisfies Record<CaptureState, string>;

// Why a session ended (SPEC §6). Advertising detection is partial: declared, not simulated.
const exitReasons = {
  CONVERGED: 'Le misure si sono stabilizzate.',
  MAX_VALID_SPEECH: 'Raggiunta la durata massima di parlato.',
  WALL_TIMEOUT: 'Raggiunti i 45 secondi di ascolto.',
  ABSOLUTE_TIMEOUT: 'Raggiunti i 120 secondi dall’avvio, pause comprese.',
  USER_STOP: 'Interrotta da te.',
  VIDEO_SEEK: 'Il video è stato spostato avanti o indietro.',
  VIDEO_CHANGED: 'È cominciato un altro video.',
  PLAYBACK_RATE_CHANGED: 'La velocità di riproduzione non è 1×: rimettila a 1× e riprova.',
  AD_OR_SOURCE_CHANGE:
    'Il video è cambiato, forse per un annuncio. Alcuni annunci potrebbero non essere riconosciuti.',
  NAVIGATED_AWAY:
    'La scheda ha lasciato il video. Se eri sulla pagina del video, ricaricala e clicca di nuovo l’icona.',
  MULTI_SPEAKER_DECLINED: 'Più voci nello stesso tratto.',
  STREAM_ENDED: 'L’audio della scheda si è interrotto.',
  OFFSCREEN_CLOSED: 'La cattura si è chiusa in modo inatteso.',
  QUALITY_REJECTED: 'La qualità dell’audio non basta.',
  CAPTURE_ERROR: 'Errore di cattura.',
} satisfies Record<CaptureExitReason, string>;

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
    exitReasons,
    stopActive: 'Interrompi la cattura in corso',
    elapsed: 'Tempo dall’avvio',
    active: 'Tempo di ascolto',
    seconds: 's',
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
