# Fixture sintetiche

Generate da `pnpm fixtures` (`scripts/fixtures/`, issue I-04). Nessun audio di persone reali né clip scaricate: solo segnali sintetici prodotti da script con seed fissi (AGENTS.md R16).

## Cosa è versionato

| File | Versionato | Perché |
|---|---|---|
| `*.wav` | **No** (`.gitignore`) | ~35 MB; si rigenerano in circa 9 s |
| `*.meta.json` | Sì | Parametri di generazione e valori attesi, letti da test e benchmark |
| `manifest.json` | Sì | SHA-256, dimensione, sample rate, canali e lunghezza di ogni WAV: è il riferimento del determinismo |

`.gitattributes` forza LF sui JSON: il confronto è byte per byte. I numeri non interi nei meta sono arrotondati a 9 decimali, perché una differenza nell'ultima cifra di `Math.log2`/`Math.exp` fra piattaforme non cambi i file.

## Comandi

- `pnpm fixtures`: rigenera WAV, meta e manifest in questa cartella.
- `pnpm fixtures --check`: rigenera in memoria e confronta con manifest e meta versionati, senza scrivere. Fallisce se un byte cambia.
- `pnpm bench`: esegue `dsp-core` su ogni WAV elencato nel manifest (verificando prima lo SHA-256) e scrive il report in `tests/benchmarks/out/` (non versionato).

## Famiglie

Elenco completo e parametri in `scripts/fixtures/catalog.ts`; corrispondenza con `docs/BENCHMARK_PROTOCOL.md` §2.

| Famiglia | Fixture | Valori attesi principali |
|---|---|---|
| silence, tone, sweep, noise, impulses | `silence`, `tone-{100,200,400}hz`, `tone-step-150-300hz`, `sweep-80-4000hz`, `noise-{white,pink}`, `impulses` | `voiceExpected: false`, `crystalExpected: false`; frequenza dei toni, campione del cambio, legge dello sweep |
| voice | `voice-a` (f0 120 Hz), `voice-b` (f0 210 Hz), `voice-a-long` (42 s, 22 s di nuclei) | f0 mediana, **traccia f0 vera ogni 10 ms**, IQR d'intonazione in semitoni, onset (campioni e secondi), sillabe, secondi sonori |
| voice-variant | `voice-a-44k`, `voice-a-plus6db`, `voice-a-minus6db` | come `voice-a`: servono alle invarianze (M3) |
| clipping | `voice-a-clipped` (+24 dB, tosata) | quota di campioni tosati |
| antiphase | `voice-a-antiphase` (stereo, R = −L) | `monoSumIsSilent: true`, `expectedOutcome: null`; la quantizzazione è simmetrica, quindi la somma è esattamente zero |
| compressed | `voice-a-compressed-4to1` | parametri del compressore (VC-10) |
| voice-music | `voice-music-{6,12,18}db-v*` (accordi da 1,5, 2 o 3 s a seconda della variante) | livello della musica rispetto alla voce, warning atteso `MIXED_AUDIO_UNCERTAIN` |
| alternating-ab | `alternating-ab-v{1,2,3}`: rapporto di f0 B/A 1,75, 1,25, 1,1 (dal facile al difficile) | turni di 2 s con parlante e confini, warning atteso `MULTI_SPEAKER_SUSPECTED` |
| a-then-b | `a-then-b` | cambio voce al campione 384000 (8 s) |

## Come si leggono i valori attesi

I valori della voce sintetica sono calcolati **dalla sintesi stessa**: la f0 effettivamente usata a ogni campione sonoro (jitter incluso) e gli onset effettivamente collocati. Non sono stime ricavate dalla forma d'onda. Definizioni:

- `f0Track`: f0 vera ogni `hopSamples` campioni (10 ms) a partire dal campione 0; `null` dove la sintesi non è sonora. È il riferimento per frame di M2 (errore relativo, errori d'ottava): confrontare la mediana di uno stimatore con `f0MedianHz` **non** misura l'errore per frame, perché i due insiemi di frame differiscono.
- `f0MedianHz`, `intonationIqrSemitones`: mediana di log2(f0) e IQR di 12·log2(f0) (quantili tipo 7) sui campioni dei nuclei sillabici con inviluppo ≥ metà del picco della sillaba.
- `onsetsPerVoicedSecond`: sillabe diviso la durata totale dei nuclei sillabici. Non coincide con «onset per secondo di voce valida» di SPEC §7.4, che dipende dal VAD: il confronto si fa in I-06.
- Livello della musica: RMS della musica = RMS attivo della voce + `musicLevelDbRelativeToVoice`. RMS attivo = RMS dei campioni sopra 10⁻³ × picco.

## Limiti noti

- **Controfase:** l'esito atteso della pipeline (`expectedOutcome`) è `null` di proposito. SPEC §7.1 chiede regole documentate per il mix in mono ma non le fissa. ADR-0016 (Proposto) propone ripiego sul canale più forte con warning `PHASE_CANCELLATION`: quando è accettato, il meta si aggiorna.
- **Arresto (I-07):** `voice-a-long` è il controllo positivo per `CONVERGED` e `MAX_VALID_SPEECH` (≥ 18 s di nuclei). I timeout (45 s attivi, 120 s assoluti) si verificano in I-07 con sequenze sintetiche di descrittori (decisione D-F). In `a-then-b` le durate sono 8 s + 10 s come nel protocollo, ma la voce valida di A è circa 3,7 s, sotto gli 8 s minimi: il test A+B dimostra qualcosa solo insieme al controllo positivo.
- **Granularità delle quote:** 5 varianti voce + musica a −12 dB e 3 alternanze A/B. «≥ 90%» significa quindi 5/5 e 3/3. Le varianti differiscono per seed, lunghezza degli accordi o coppia di parlanti, ma restano poche.
- **Alternanza:** i tagli ogni 2 s possono spezzare una sillaba (dissolvenza di 10 ms) e creare onset spuri. Onset e f0 per turno non sono nei meta.
- Gli hash dipendono dall'aritmetica in virgola mobile e da `Math.sin`/`Math.exp` di V8. Sono verificati con la versione di Node di `.nvmrc`; un aggiornamento di Node o un'architettura diversa può cambiarli. In quel caso `pnpm fixtures --check` fallisce: si rigenera, si annota il motivo nel commit e si incrementa `FIXTURES_VERSION` se cambiano i parametri.
- La voce sintetica è un modello sorgente-filtro semplice (impulso glottale di Rosenberg, quattro formanti per vocale). Non riproduce coarticolazione, consonanti né prosodia naturale: serve a misurare accuratezza e invarianze, non a calibrare `mapping-1` (che richiede il dataset umano, I-08).
