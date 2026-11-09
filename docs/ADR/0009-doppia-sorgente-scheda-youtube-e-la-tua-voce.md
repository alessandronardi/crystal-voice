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

## Riferimenti

SPEC §2, §3, §5
