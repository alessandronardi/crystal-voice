# ADR-0004: Watchdog di sessione con heartbeat

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

La cattura `tabCapture` resta attiva attraverso le navigazioni nella stessa scheda: un link esterno porterebbe ad analizzare l'audio di un altro sito (VC-04).

## Decisione

- Il content script invia `HEARTBEAT` ogni 1 s su pagine `/watch`.
- L'offscreen interrompe con `NAVIGATED_AWAY` dopo 3 s senza heartbeat o se URL o `videoId` cambiano.
- Segnali aggiuntivi: `tabs.onRemoved`, `tabCapture.onStatusChanged`, `MediaStreamTrack` `ended`.
- Tutte le uscite passano da `stopSession(reason)` idempotente.

## Conseguenze

Fino a 3 s di audio di un'altra pagina possono transitare nel pass-through, ma vengono scartati dall'analisi (i frame dopo l'ultimo heartbeat valido non entrano nelle statistiche).

## Alternative scartate

Permesso `tabs` per leggere l'URL (permesso più ampio, solo se I-03 lo dimostra necessario).

## Verifica

Scenario S3 automatizzato o manuale: stop entro 3 s.

## Nota di attuazione (2026-11-11, I-03)

- **Cambio di `videoId`:** l'uscita è `INTERRUPTED / VIDEO_CHANGED`, come in SPEC §6.1, e non `NAVIGATED_AWAY` come scritto sopra. Decisione del product owner del 2026-11-11. `NAVIGATED_AWAY` resta per un URL fuori da `/watch` e per l'assenza di heartbeat.
- **Segnali aggiuntivi attuati:**
  - `tabs.onRemoved`;
  - `tabs.onUpdated`, con un URL leggibile fuori da `/watch` o `status: 'loading'` senza URL;
  - `tabCapture.onStatusChanged`;
  - `MediaStreamTrack` `ended`, con un'attesa di 500 ms [H] del motivo dal service worker.
- **Content script su tutto `www.youtube.com`:** ADR-0021.

## Riferimenti

[tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
