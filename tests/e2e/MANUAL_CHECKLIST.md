# Checklist manuale in Chrome reale

Da eseguire quando l'E2E automatico non copre un passo (gesto sulla toolbar, ascolto, microfono reale). Ogni esecuzione si registra in fondo e si allega al verbale di gate.

**Preparazione:** `pnpm build`; caricare `dist/extension/` da `chrome://extensions` in modalità sviluppatore; cuffie o casse; un video di riferimento con parlato pulito, uno con musica di sottofondo, una intervista a due voci.

| # | Scenario | Passi | Atteso | Rif. |
|---|---|---|---|---|
| M0 | Caricamento | In Chrome 120 e in Chrome stabile: `chrome://extensions` → modalità sviluppatore → «Carica estensione non pacchettizzata» → `dist/extension/`; apri «Service worker»; apri la Side Panel dal menu dei pannelli laterali di Chrome (il click sull'icona non fa ancora nulla fino a I-02) | Nessun errore nel pannello estensioni né nella console del service worker; la Side Panel mostra «VoiceCrystal» | I-01 |
| M1 | Avvio | Apri un video `/watch`, avvia la riproduzione, clic sull'icona | Pannello aperto; indicatore di cattura di Chrome visibile; audio udibile una sola volta | ADR-0002 |
| M2 | Stop | Durante l'ascolto premi «Interrompi» | Indicatore spento; audio normale; pannello in `HOME` | §6 |
| M3 | Pausa lunga | Avvia, metti in pausa 60 s, riprendi | Sessione viva; stato «In pausa»; alla ripresa riprende il conteggio | ADR-0003 |
| M4 | Navigazione esterna | Avvia, clicca un link verso un altro sito nella stessa scheda | Stop entro 3 s con messaggio; audio del nuovo sito normale | ADR-0004 |
| M5 | Cambio video | Avvia, clicca un video suggerito | `INTERRUPTED` con messaggio | §6 |
| M6 | Velocità | Avvia, imposta 1,5× | `INTERRUPTED` con richiesta di tornare a 1× | §6 |
| M7 | Seek | Avvia, salta avanti di 30 s | `INTERRUPTED` | §6 |
| M8 | Annuncio | Video con pre-roll o mid-roll | Interruzione rilevata o limite dichiarato in UI | §6 |
| M9 | Chiusura scheda | Avvia, chiudi la scheda | Nessuna cattura residua (`chrome://extensions` → service worker → nessun errore; indicatore assente) | §14 |
| M10 | Doppio click | Clic due volte sull'icona | Una sola sessione; nessun doppio audio | §5 |
| M11 | Service worker terminato | Avvia, termina il SW da `chrome://serviceworker-internals` | La sessione prosegue o si chiude pulita; stop funziona | VC-16 |
| M12 | Schermo intero | Avvia, passa a schermo intero e torna | Cattura invariata | §5 |
| M13 | Microfono, prima volta | Pannello → «Usa il microfono» | Pagina di permesso; dopo il consenso la cattura parte; indicatore di registrazione visibile | ADR-0009 |
| M14 | Microfono, stop | Chiudi il pannello durante l'ascolto | Indicatore di registrazione spento | §14 |
| M15 | File | Pannello → «Scegli un file» con una fixture | Risultato identico all'harness Node | I-18 |
| M16 | Volume a zero | Avvia con il player muto | Avviso `PLAYER_MUTED` | VC-19 |
| M17 | Vetrina: frame time | Su hardware reale con GPU (non in una sessione remota senza GPU): `pnpm bench:render`. Annota modello di CPU e GPU, driver, SO, risoluzione e scala dello schermo | `tests/benchmarks/out/render-latest.json` riporta `reference: true` (il bench lo mette a `false` da solo se la GPU è un rasterizzatore software come SwiftShader) e la GPU reale. Mediana del primo frame e costo frame p50/p90/p95 di vetrina ed economy trascritti nel registro qui sotto. Nessuna soglia finché non esiste una prima misura | I-11 |
| M18 | Vetrina: memoria GPU | `pnpm bench:render --pause 20`. Durante le due attese apri il Task Manager di Chrome (Maiusc+Esc), attiva la colonna «Memoria GPU» dal menu contestuale e annota il valore del processo GPU prima e dopo i 100 cicli | Dopo i cicli la memoria GPU torna al valore di partenza entro il rumore. Annota entrambi i numeri | I-11 |
| M19 | Vetrina: aspetto e veli | `pnpm bench:render --show 60`: alla fine mostra per 60 s, su GPU reale, lo stesso cristallo senza veli (sinistra) e con p1 e p4 velati (destra), che ruotano | Cristallo leggibile; i tratti velati si riconoscono come smerigliati o sbiaditi. Un velo si vede solo se l'elemento esiste (secondari per p3, inclusioni per p4, più di una banda per p6): altrimenti lo dice solo il cartellino (I-13). Giudizio estetico per il G2 | I-11, G2 |

## Registro esecuzioni

| Data | Commit | Chrome / SO | Esecutore | Esiti (M0…M19) | Note |
|---|---|---|---|---|---|
| 2026-11-09 | `affa212` | Chrome 120 e Chrome stabile; versioni esatte e SO non indicati | Alessandro Nardi (product owner) | M0 superato · M1–M16 non applicabili (funzioni non ancora implementate, da I-02 in poi) | Esito comunicato in chat all'agente, che lo ha trascritto ma non lo ha osservato. Da completare con le versioni esatte di Chrome e il SO. Eseguito prima di ADR-0015 (`connect-src`): la CSP aggiunta è coperta dall'E2E in Chromium, non da questa esecuzione. |
