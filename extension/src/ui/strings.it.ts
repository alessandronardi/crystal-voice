// Centralised Italian UI strings (AGENTS.md §8, §9). Never inline UI text.
import type {
  CaptureAnalysisFailure,
  CaptureErrorCode,
  CaptureExitReason,
  CaptureState,
  DescriptorKey,
  QualityWarning,
} from '@voicecrystal/contracts';

/** Names of the six descriptors (docs/GLOSSARY.md, SPEC §7.4). */
const descriptorNames = {
  p1_pitch: 'Altezza',
  p2_intonation: 'Variabilità d’intonazione',
  p3_dynamics: 'Dinamica',
  p4_roughness: 'Ruvidità',
  p5_brightness: 'Brillantezza',
  p6_rhythm: 'Ritmo',
} satisfies Record<DescriptorKey, string>;

const warningNames = {
  MIXED_AUDIO_UNCERTAIN: 'possibile musica di sottofondo',
  MULTI_SPEAKER_SUSPECTED: 'forse più di una voce',
  LOW_CONFIDENCE_PARAMETER: 'alcuni tratti poco affidabili (velati)',
  CLIPPING: 'audio saturato',
  LOW_LEVEL: 'volume basso',
  PLAYER_MUTED: 'player muto',
  EXPERIMENTAL_MAPPING: 'mappatura sperimentale, non calibrata',
  PHASE_CANCELLATION: 'canali in controfase: usato un solo canale',
} satisfies Record<QualityWarning, string>;

const analysisFailures = {
  VAD_UNAVAILABLE: 'Il rilevatore di voce non è disponibile: analisi non eseguita.',
  ANALYSIS_FAILED: 'L’analisi non è riuscita.',
  ANALYSIS_TIMEOUT: 'L’analisi ha impiegato troppo tempo ed è stata interrotta.',
} satisfies Record<CaptureAnalysisFailure, string>;

/** Technical rows of the experimental analysis (I-06b), until the crystal view of I-13. */
const analysis = {
  heading: 'Analisi sperimentale',
  note: 'Valori tecnici provvisori: la mappatura non è ancora calibrata (mapping-0).',
  outcome: 'Esito',
  outcomeOk: 'cristallo possibile',
  outcomeInsufficient: 'dati insufficienti',
  seed: 'Seme (sei interi 0–10000)',
  warnings: 'Avvisi',
  missing: 'Tratti non misurabili',
  veiled: 'Tratti velati',
  validSpeech: 'Voce valida',
  analysed: 'Audio analizzato',
  none: 'nessuno',
  seconds: 's',
  failures: analysisFailures,
  descriptors: descriptorNames,
  warningNames,
} as const;

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

// Microphone wording where the tab wording would be wrong (I-17).
const micErrors = {
  MIC_PERMISSION_REQUIRED:
    'Serve l’autorizzazione al microfono. Si concede una volta sola, nella pagina di autorizzazione di VoiceCrystal.',
  STREAM_NOT_AVAILABLE:
    'Il microfono non è disponibile: controlla che sia collegato e che un’altra applicazione non lo stia usando.',
} satisfies Partial<Record<CaptureErrorCode, string>>;

const micExitReasons = {
  STREAM_ENDED: 'Il microfono si è interrotto: scollegato, usato da un’altra applicazione o autorizzazione revocata.',
  USER_STOP: 'Interrotta da te, o perché il pannello è stato chiuso.',
} satisfies Partial<Record<CaptureExitReason, string>>;

// Local-file source (I-18). Why a file was refused, by refusal reason.
const fileRefusals = {
  DURATION: 'Il file è troppo lungo: si accettano file fino a 30 minuti.',
  MEMORY:
    'Il file è troppo grande da decodificare in memoria. Prova un file più corto, oppure un WAV: di un WAV si legge solo il tratto scelto.',
  MEMORY_WINDOW:
    'Anche solo il tratto da analizzare è troppo grande da decodificare in memoria: la frequenza di campionamento o il numero di canali del file sono molto alti.',
  NO_DURATION: 'Il file non si può leggere: la sua durata non è leggibile. Prova un altro formato, per esempio WAV.',
  EMPTY: 'Il file non contiene audio.',
  DECODE: 'Il file non si può leggere: il formato non è supportato o il file è danneggiato.',
} as const;

const filePhases = {
  idle: 'Scegli un file audio per analizzarlo su questo dispositivo.',
  probing: 'Lettura del file…',
  ready: 'Scegli il punto di partenza e premi «Analizza».',
  starting: 'Avvio dell’analisi…',
  decoding: 'Decodifica del file…',
  analyzing: 'Analisi in corso…',
  done: 'Analisi completata.',
  failed: 'Analisi non riuscita.',
  stopped: 'Analisi interrotta.',
} as const;

export const strings = {
  analysis,
  appName: 'VoiceCrystal',
  pages: {
    sidepanel: { title: 'VoiceCrystal', heading: 'VoiceCrystal' },
    collection: { title: 'Collezione · VoiceCrystal', heading: 'Collezione' },
    permission: { title: 'Microfono · VoiceCrystal', heading: 'Autorizzazione del microfono' },
  },
  placeholder: 'In costruzione.',
  permission: {
    intro:
      'VoiceCrystal ascolta la tua voce e la analizza su questo dispositivo: l’audio non viene salvato né inviato. Il browser chiede il permesso del microfono una volta sola, qui: il pannello laterale non può chiederlo.',
    allow: 'Consenti il microfono',
    asking: 'Rispondi alla richiesta del browser…',
    granted:
      'Fatto: il microfono è autorizzato. Torna al pannello di VoiceCrystal e premi «Usa il microfono». Puoi chiudere questa scheda.',
    denied:
      'Il microfono non è autorizzato. Per cambiarlo: clicca l’icona a sinistra dell’indirizzo di questa pagina, imposta Microfono su «Consenti» e ricarica la pagina.',
    unavailable: 'Nessun microfono disponibile: controlla che sia collegato e che un’altra applicazione non lo stia usando.',
  },
  capture: {
    idle: 'Apri un video su YouTube e clicca l’icona di VoiceCrystal per ascoltarlo, oppure usa il microfono.',
    useMic: 'Usa il microfono',
    openPermission: 'Apri la pagina di autorizzazione',
    micNote: 'Il microfono resta acceso finché questo pannello è aperto, al massimo 45 secondi di ascolto.',
    micErrors,
    micExitReasons,
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
  file: {
    heading: 'Da un file',
    choose: 'File audio',
    note: 'Si analizzano al massimo 120 secondi dal punto di partenza. Il file resta su questo dispositivo e non viene salvato.',
    start: 'Partenza (secondi)',
    analyze: 'Analizza',
    stop: 'Interrompi',
    phases: filePhases,
    refusals: fileRefusals,
    startPastEnd: 'Il punto di partenza è oltre la fine del file: scegline uno più basso.',
    errors: captureErrors,
    name: 'File',
    duration: 'Durata del file',
    window: 'Tratto analizzato',
    sourceRate: 'Frequenza del file',
    channels: 'Canali',
    monoRule: 'Mix mono',
    analysisSamples: 'Campioni a 16 kHz',
    pitchFrames: 'Frame (sonori / totali)',
    medianF0: 'f0 mediana',
    digest: 'Impronta del segnale (SHA-256)',
    seconds: 's',
    hertz: 'Hz',
    unavailable: 'non disponibile',
    to: '–',
  },
} as const;

export type PageKey = keyof typeof strings.pages;
