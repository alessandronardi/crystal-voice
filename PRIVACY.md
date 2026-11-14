# Informativa sulla Privacy — VoiceCrystal

Ultimo aggiornamento: 13 novembre 2026

VoiceCrystal è un'estensione per browser open-source che genera cristalli 3D decorativi a partire da parametri acustici del parlato.

## 1. Nessuna raccolta o trasmissione di dati (Zero Data Collection)
VoiceCrystal opera esclusivamente in locale sul dispositivo dell'utente:
- Non utilizza server esterni, database remoti, account utente, sistemi di analisi (analytics) o telemetria.
- La Content Security Policy dell'estensione (`connect-src 'self'`) impedisce tecnicamente qualsiasi connessione di rete verso l'esterno.
- Lo sviluppatore non ha accesso ad alcun audio, file, cronologia di navigazione o cristallo generato dall'utente.

## 2. Gestione temporanea dell'audio
- L'audio proveniente dal microfono, da un file locale o dalla scheda attiva del browser (attivato esclusivamente su comando esplicito dell'utente) viene elaborato in tempo reale nella sola memoria volatile (RAM) per una durata massima di 120 secondi e poi immediatamente scartato.
- Nessun frammento audio viene mai salvato su disco o esportato.

## 3. Dati salvati in locale
- L'estensione utilizza lo spazio di archiviazione locale del browser (`chrome.storage`) esclusivamente per conservare lo stato della sessione e l'archivio personale dei cristalli dell'utente (composto dai 6 numeri interi del seme geometrico, versione dell'algoritmo, miniatura 3D ed eventuale etichetta inserita dall'utente).
- Tali dati risiedono unicamente sul computer dell'utente e possono essere cancellati in qualsiasi momento tramite l'interfaccia dell'estensione o disinstallando l'estensione.

## 4. Natura non biometrica
I 6 parametri acustici estratti (altezza, intonazione, dinamica, ruvidità, brillantezza, ritmo) hanno finalità esclusivamente estetica e sperimentale: non consentono l'identificazione univoca del parlante, non costituiscono dati biometrici ai sensi dell'Art. 9 del Regolamento UE 2016/679 (GDPR) e non effettuano riconoscimento delle emozioni.

## 5. Contatti
Repository ufficiale del progetto: https://github.com/alessandronardi/crystal-voice
