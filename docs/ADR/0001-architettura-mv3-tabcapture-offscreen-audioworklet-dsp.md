# ADR-0001: Architettura MV3: tabCapture → offscreen → AudioWorklet → DSP worker

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Il service worker MV3 non può ospitare `AudioContext` e viene terminato da Chrome. Serve un contesto DOM persistente per lo stream audio e un thread separato per il DSP, senza bloccare il thread audio.

## Decisione

- Il service worker coordina; l'offscreen document possiede stream, `AudioContext`, pass-through, `AudioWorklet` e watchdog.
- L'`AudioWorkletProcessor` accumula solo blocchi PCM e li invia al `dsp-worker` tramite `MessagePort` con buffer trasferibili.
- Il DSP gira nel worker usando `packages/dsp-core`, identico a quello eseguito in Node nei test.
- Requisito: Chrome 116+ per usare in offscreen lo stream ID ottenuto nel service worker; `minimum_chrome_version` = 120.

## Conseguenze

Architettura ufficialmente documentata; DSP testabile offline. Costo: messaggistica fra quattro contesti, da tipizzare in `packages/contracts`.

## Alternative scartate

`chrome.tabCapture.capture()` nel pannello (il pannello può essere chiuso dall'utente); `SharedArrayBuffer` (richiede isolamento cross-origin, rinviato).

## Verifica

E2E avvio/stop (I-02); test unit del worker su fixture (I-04).

## Riferimenti

SPEC §5; [tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
