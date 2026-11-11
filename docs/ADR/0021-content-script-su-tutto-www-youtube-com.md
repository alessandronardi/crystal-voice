# ADR-0021: Content script su tutto `https://www.youtube.com/*`

- **Stato:** Accettato
- **Data:** 2026-11-11
- **Decisori:** product owner (scelta in chat il 2026-11-11, pianificazione di I-03)

## Contesto

SPEC §5 dichiara il content script sul match `https://www.youtube.com/watch*` e chiede di «verificare la compatibilità del match pattern con le URL reali».

YouTube è un'applicazione a pagina singola: da home, ricerca o canale si arriva a un video con `history.pushState`, senza caricare una pagina nuova. Chrome inietta i content script solo al caricamento di un documento che corrisponde al match. Se la pagina è stata aperta fuori da `/watch` e l'utente arriva al video navigando, lo script non c'è.

In I-03 il watchdog (ADR-0004) interrompe la cattura dopo 3 s senza heartbeat, quindi nel caso più comune l'avvio fallirebbe.

## Decisione

- Il manifest dichiara il content script su `https://www.youtube.com/*`, stesso host, nessun permesso nuovo. **Prevale sul match di SPEC §5.**
- Lo script è inerte finché non riceve dal service worker `SESSION_BIND` per una sessione attiva: non legge nulla e non invia messaggi.
- Con una sessione legata invia l'heartbeat a 1 Hz con l'URL corrente. Se l'URL non è più `/watch`, l'offscreen interrompe subito con `NAVIGATED_AWAY` e risponde di smettere. Se lo script sparisce (navigazione verso un altro host), il watchdog interrompe dopo 3 s; di solito prima ci pensa il service worker, con `tabs.onUpdated`.
- Restano valide R4 e R5: solo l'elemento `<video>` standard, nessuna lettura di classi o variabili interne di YouTube.
- La guardia del bundle accetta solo questo match.

## Conseguenze

- La cattura funziona anche dopo una navigazione interna verso `/watch`.
- L'avviso di installazione di Chrome resta sullo stesso host (`www.youtube.com`).
- Lo script è caricato anche su pagine che non sono video: il suo costo è un listener di messaggi, senza lavoro finché non c'è una sessione.
- Non copre `m.youtube.com` né `music.youtube.com`, come prima.

## Alternative scartate

- Permesso `scripting` e iniezione al click con `activeTab`: permesso nuovo (R9) per lo stesso risultato.
- Nessuna modifica: chiedere di ricaricare la pagina se lo script non risponde. Peggiora l'esperienza nel caso più comune.

## Verifica

- E2E: navigazione con `pushState` da una pagina non `/watch` a `/watch`, poi avvio dalla toolbar → cattura viva con heartbeat.
- E2E: senza sessione lo script non invia messaggi.
- Test della guardia del bundle: il nuovo match è accettato, gli altri no.

## Riferimenti

SPEC §5; ADR-0004; [Content scripts, match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
