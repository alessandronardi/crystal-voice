# extension/ — regole locali (Chrome MV3)

Valgono `AGENTS.md` e `CLAUDE.md` della radice. Qui ci sono i vincoli specifici della piattaforma. Riferimenti: SPEC §5, §6, §14; ADR-0001…0004, ADR-0009, ADR-0011.

## Responsabilità per contesto

| Contesto | Fa | Non fa mai |
|---|---|---|
| Service worker | `action.onClicked`, apertura pannello, creazione offscreen, `getMediaStreamId`, instradamento, `chrome.storage.session` | `AudioContext`, DSP, stato autorevole in variabili globali |
| Content script | Legge `<video>` standard (`currentTime`, `paused`, `playbackRate`, `muted`, `volume`, eventi), `videoId` dall'URL, heartbeat 1 Hz | Classi DOM o variabili interne di YouTube, modifiche al player, analisi audio |
| Offscreen | `getUserMedia` (scheda o microfono), pass-through, AudioWorklet, DSP worker, watchdog, macchina di cattura autorevole | API `chrome.*` diverse da `chrome.runtime` (non disponibili) |
| Side Panel | Home, ascolto, rivelazione, cartellino, decodifica file | Avviare `tabCapture`; ospitare la Collezione |
| Collection page | Griglia, filtri, confronto | Catture |

## Sequenza di avvio obbligatoria (ADR-0002, ADR-0003)

```ts
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id }); // 1. sincrono, prima di ogni await
  void startTabCapture(tab.id);                  // 2. ensureOffscreen() → getMediaStreamId() → send
});
```

- `ensureOffscreen()` usa `reasons: ['USER_MEDIA', 'WORKERS']` e protegge dalla creazione concorrente con una promessa condivisa.
- Lo stream ID si chiede **dopo** che l'offscreen esiste, si invia subito, una volta sola, mai salvato.
- Niente `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

## Watchdog (ADR-0004)

- Heartbeat dal content script ogni 1 s con `sessionId`, `videoId`, `url`, stato del player.
- L'offscreen interrompe con `NAVIGATED_AWAY` dopo 3 s senza heartbeat o se URL/`videoId` cambiano.
- `tabs.onRemoved` e `tabCapture.onStatusChanged` sono segnali aggiuntivi.
- Ogni uscita passa da un unico `stopSession(reason)` idempotente che: ferma le tracce, scollega i nodi, chiude l'`AudioContext`, termina il worker, emette il messaggio finale, torna a `IDLE`. Tutto in `finally`.

## Messaggi

- Tipi solo da `packages/contracts`. Ogni messaggio ha `v`, `sessionId`, `seq` crescente per mittente.
- Messaggi con `sessionId` diverso dalla sessione attiva o `seq` non crescente: ignorati e contati, mai lanciano eccezioni.
- Nessun PCM verso service worker o UI.

## Test

- Unit con mock di `chrome.*` solo per la logica di instradamento.
- Il comportamento reale (gesto, pass-through, pausa oltre 30 s, navigazione esterna, SW terminato) si verifica in Chrome reale: E2E Playwright dove possibile, altrimenti `tests/e2e/MANUAL_CHECKLIST.md`. Se non eseguito, dichiaralo.
