# Protocollo di benchmark e calibrazione (G1)

Questo protocollo definisce come si misurano i descrittori e come si congelano le tabelle di calibrazione. Ogni numero riportato in un report deve essere riproducibile da questo protocollo. **Nessun numero si riporta senza averlo misurato** (AGENTS.md R14).

## 1. Ambiente di misura

Ogni report dichiara: commit, `extractorVersion`, `mappingVersion`, versione di Node e di Chrome, CPU, sistema operativo, data. Le misure DSP si eseguono in Node con `pnpm bench`; le misure di cattura in Chrome reale.

## 2. Fixture sintetiche (nel repository)

Generate da `pnpm fixtures` con seed fissi; ogni WAV ha un `.meta.json` con parametri e valori attesi.

| Famiglia | Contenuto | Serve a |
|---|---|---|
| Silenzio, rumore bianco/rosa, impulsi | Nessuna voce | Rifiuto |
| Toni puri 100–400 Hz, sweep | f0 noto, nessuna voce | Rifiuto, accuratezza pitch |
| Voce sintetica | Treno glottale + formanti, f0 e intonazione noti, sillabe a ritmo noto | Accuratezza di p1, p2, p6 |
| Clipping, controfase | Difetti di catena | Robustezza |
| A+B | Due voci sintetiche consecutive (8 s + 10 s) | Arresto split-half |
| Alternanza A/B | Turni di 2 s | Euristica più voci |
| Voce + musica | Accordi sintetici sostenuti a −6, −12, −18 dB | Euristica musica, confidenza |
| Voce compressa | Compressore 4:1 | Sensibilità di p3 (VC-10) |
| Varianti | ±6 dB, 44,1/48 kHz | Invarianze |

## 3. Dataset umano (fuori repository)

- **Composizione minima [H]:** 15 parlanti adulti consenzienti; 4 segmenti per parlante (lettura neutra, lettura espressiva, parlato spontaneo, lingua diversa se possibile); 2 microfoni (cuffia e laptop); 20–40 s per segmento.
- **Consenso:** modulo scritto con finalità (calibrazione di un generatore artistico), conservazione, diritto di cancellazione. Moduli e audio conservati fuori repository, con accesso limitato.
- **Divisione:** per parlante, 10 per calibrare e 5 per valutare. Nessun parlante in entrambi i set.
- **Raccolta:** con la sorgente microfono dell'estensione in modalità sviluppo che salva il PCM **solo** in questo flusso di raccolta, con flag di build `VC_DATASET_CAPTURE=true` mai presente nelle build di distribuzione. In alternativa: registrazione esterna in WAV 48 kHz.
- **Variabili controllate sul set di valutazione:** guadagno ±6 dB, rumore di fondo a 20 dB SNR, compressione Opus 64 kbps, musica a −12 dB.

## 4. Metriche da riportare

| # | Metrica | Calcolo | Obiettivo iniziale [H] |
|---|---|---|---|
| M1 | Rifiuto | Quota di fixture senza voce che producono un cristallo | 0% |
| M2 | Pitch | Errore mediano relativo di f0; quota di errori d'ottava | ≤ 1%; ≤ 2% |
| M3 | Invarianza | Δ massimo per parametro fra varianti ±6 dB e 44,1/48 kHz | ≤ 1 punto |
| M4 | Musica | Quota di varianti voce + musica −12 dB con `MIXED_AUDIO_UNCERTAIN` | ≥ 90% |
| M5 | Più voci | Quota di alternanze A/B con `MULTI_SPEAKER_SUSPECTED` | ≥ 90% |
| M6 | Distribuzioni | Istogramma di ogni `p_i` sul set di valutazione; quota a 0 o 100 | ≈ uniforme; ≤ 5% saturati |
| M7 | Correlazioni | Matrice di Spearman fra i sei descrittori | nessun \|ρ\| > 0,5 |
| M8 | Stabilità intra | Per coppie di segmenti dello stesso parlante: Δ per parametro (mediana, IQR); quota con forma principale diversa | forma diversa ≤ 10% |
| M9 | Separazione | Percentile di vicinanza: mediana intra e inter parlante; curve sovrapposte | intra ≥ 70; inter ≈ 50 |
| M10 | Robustezza | Δ per parametro sotto rumore, Opus, musica | riportare, nessun obiettivo fisso |
| M11 | Arresto | Δ fra seed all'arresto anticipato e seed a 18 s | ≤ 5 punti nel 90% |
| M12 | Prestazioni | Tempo DSP per secondo di audio; overrun | ≤ 0,2 s/s; 0 overrun |

Le distribuzioni si riportano con grafici e tabelle; nessuna metrica è sintetizzata in un'unica «accuratezza».

## 5. Procedura di calibrazione

1. Calcolare le misure grezze `x_i` sui segmenti del set di calibrazione con `extractorVersion` fissata.
2. Per ogni descrittore, tabulare 101 percentili (P0…P100, interpolazione lineare tipo 7). Garantire monotonia stretta con un epsilon documentato.
3. Per `p5_brightness` da `mapping-1`: stimare la retta `log2(centroide) ~ a + b·log2(f0)` sul set di calibrazione e tabulare i quantili del residuo.
4. Per il comparator: calcolare `D` su tutte le coppie di parlanti diversi del set di calibrazione e tabulare `G`.
5. Valutare **solo** sul set di valutazione e riportare M6–M11.
6. Congelare in `packages/calibration/mapping-1.json` e `comparator-1.json` con hash del dataset (non i dati) e data.

## 6. Regole

- Cambiare una soglia `[H]` richiede una misura registrata qui o nel report di gate.
- Un risultato peggiore dell'obiettivo **si riporta**, non si nasconde. Si decide al gate se ridimensionare la promessa.
- Il dataset di valutazione non si usa per scegliere parametri; se succede, va dichiarato e serve un nuovo set.
