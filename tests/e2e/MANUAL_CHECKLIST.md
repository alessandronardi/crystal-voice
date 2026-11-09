# Checklist manuale in Chrome reale

Da eseguire quando l'E2E automatico non copre un passo (gesto sulla toolbar, ascolto, microfono reale). Ogni esecuzione si registra in fondo e si allega al verbale di gate.

**Preparazione:** `pnpm build`; caricare `dist/extension/` da `chrome://extensions` in modalità sviluppatore; cuffie o casse; un video di riferimento con parlato pulito, uno con musica di sottofondo, una intervista a due voci.

| # | Scenario | Passi | Atteso | Rif. |
|---|---|---|---|---|
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

## Registro esecuzioni

| Data | Commit | Chrome / SO | Esecutore | Esiti (M1…M16) | Note |
|---|---|---|---|---|---|
| | | | | | |
