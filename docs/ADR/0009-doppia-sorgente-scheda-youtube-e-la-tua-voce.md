# ADR-0009: Doppia sorgente: scheda YouTube e «La tua voce»

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Il valore del prodotto non deve dipendere dall'esito della valutazione legale G0 (VC-01). Il microfono dell'utente è anche il banco di prova più pulito per la calibrazione.

## Decisione

- Sorgenti `tab`, `mic`, `file` con lo stesso DSP e generatore.
- Il microfono richiede una prima autorizzazione in una pagina visibile dell'estensione (`permission.html`); poi l'offscreen lo usa (`needs current-doc verification`, I-17).
- I file si decodificano nel pannello con `decodeAudioData`.
- La sorgente scheda è disattivabile a build time (`VC_SOURCE_TAB=false`), rimuovendo anche il permesso `tabCapture`.

## Conseguenze

Tre esiti di G0 possibili senza riscritture. Più superficie da testare.

## Alternative scartate

Solo YouTube (rischio di prodotto non pubblicabile); web app separata (duplicazione UI).

## Verifica

Stessi test DSP su sorgente file; E2E microfono con dispositivo finto di Chrome (`--use-fake-device-for-media-stream`).

**Nota di attuazione (I-17, 2026-11-11).** Il `needs current-doc verification` sul microfono:
- **Brave (Chromium 157), Windows 11:** verificato secondo il product owner. Con il permesso dato in `permission.html` (scheda dell'estensione), l'offscreen apre il microfono da solo, anche dopo la chiusura di quella scheda (M13, M13b, M13c, M14: «Tutto funzionante», comunicato in chat; l'agente non l'ha osservato).
- **Chromium 156 di Playwright:** con il permesso concesso via CDP sull'origine dell'estensione l'offscreen apre il microfono; senza permesso `getUserMedia` fallisce subito, senza bloccarsi (`tests/e2e/mic.spec.ts`).
- **Google Chrome stabile e Chrome 120:** non eseguito. Per I-17 la verifica in Brave basta (decisione del product owner, 2026-11-11).

Nessun ADR di spostamento della cattura nella pagina visibile è servito.

**Nota di attuazione (I-18, 2026-11-12).** I file si decodificano nel pannello con `decodeAudioData`, come deciso qui.
- **Dove gira il DSP:** in un `dsp-worker` dedicato del pannello, non in quello dell'offscreen ([ADR-0022](0022-analisi-dei-file-locali-in-un-dsp-worker-del-pannello.md)).
- **WAV:** si decodifica solo la finestra di 120 s, alla frequenza del file.
- **Altri formati:** si decodificano interi a 48 kHz, con un budget di memoria [H].
- **«Stessi test DSP su sorgente file»:** `tests/e2e/file.spec.ts`. Con gli stessi campioni decodificati, la parte aritmetica dell'analisi coincide bit per bit con Node su tutte le fixture. Il decoder di Chromium converte però int16 diversamente dall'harness, e alcune funzioni di `Math` differiscono di 1–2 ULP (VC-24).

## Riferimenti

SPEC §2, §3, §5
