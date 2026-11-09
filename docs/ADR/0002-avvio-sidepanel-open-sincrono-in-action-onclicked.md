# ADR-0002: Avvio: `sidePanel.open()` sincrono in `action.onClicked`

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

`sidePanel.open()` funziona solo in risposta a un gesto dell'utente e fallisce se chiamato dopo un `await`. Con `setPanelBehavior({ openPanelOnActionClick: true })` è segnalato che `action.onClicked` non viene più ricevuto (VC-02).

## Decisione

- Nessun `setPanelBehavior`.
- In `action.onClicked`, la prima istruzione è `void chrome.sidePanel.open({ tabId })`, senza `await` precedenti.
- Poi, in modo asincrono: `ensureOffscreen()`, `tabCapture.getMediaStreamId({ targetTabId })`, invio dell'ID all'offscreen.
- Su pagina non `/watch` il pannello si apre ma la cattura non parte (`NOT_YOUTUBE_WATCH`).

## Conseguenze

Un solo gesto apre il pannello e avvia la cattura. Ogni click sull'icona tenta una cattura: il pannello deve gestire `CAPTURE_BUSY`.

## Alternative scartate

Pulsante «Avvia» nel pannello (il click nel pannello non concede `activeTab` sulla scheda: da verificare, quindi scartato); popup dell'action (doppio click per l'utente).

## Verifica

E2E 100 avvii, anche con service worker dormiente (I-02, I-03).

## Riferimenti

[sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel); thread Chromium Extensions citati in SPEC §19
