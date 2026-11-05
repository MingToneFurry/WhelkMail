# TODO

Stato al 2026-11-05. Le voci sono ordinate per dipendenza tecnica consigliata.

## Completato

- [x] Etichette personalizzate unificate per tutti gli account: creazione dalla sidebar o dall'editor filtri; assegnazione dal pannello di lettura e vista etichetta Gmail-style da Inbox, Inviate e Bozze.
- [x] Etichetta automatica per account: scelta durante l'aggiunta dell'account o nelle impostazioni; ogni email in arrivo di quell'account viene etichettata.
- [x] Filtri Gmail-style unificati in Impostazioni: criteri Da/A/Oggetto/parole/allegato e azione “applica etichetta”, con creazione/modifica/attivazione/eliminazione. Valutati al caricamento della Posta in arrivo.
- [x] Firme: scelta tra firma unica per tutti gli account o firma diversa per ciascuno, inserimento automatico in nuove email e risposte.
- [x] Vista mobile: sidebar a scomparsa, topbar responsive, pannello di lettura a schermo intero.
- [x] Migrazione D1 per etichette/firme (`npm run db:migrate:remote`).
- [x] Rubrica contatti: tabella `contacts`, API CRUD, vista Rubrica con ricerca, autocomplete destinatari in To/Cc/Bcc, import/export CSV e deduplica per email.
- [x] Rebrand completo in WhelkMail: nome prodotto, titolo pagina, package, documentazione, logo e favicon con conchiglia di buccina.
- [x] Sync metadati IMAP in D1: incrementale, chunked/resumable, `UIDVALIDITY`, cartelle speciali, trasferimento etichette sui movimenti e stato/errore in Impostazioni.
- [x] Rifiniture sync: archiviazione opzionale di corpi/allegati su R2 o Google Drive, ripresa automatica delle sync parziali e barra di avanzamento.
- [x] PWA e Web Push: manifest, service worker, sottoscrizioni push in D1, VAPID, worker cron schedulato, preferenze per account/cartella e gestione permessi/revoca.
- [x] Inoltro come azione dei filtri (stile Gmail): criteri + applica etichette e/o inoltra a destinatari, worker cron, EML originale allegato, anti-loop, log per filtro e UI in Impostazioni.
- [x] Eliminazione dal provider dopo archiviazione: flag opt-in per account, verifica archivio, spostamento nel Cestino del provider, conferma esplicita, log e disattivazione.
- [x] Sync automatica in background: flag opt-in per account, worker cron ogni 5 minuti su Inbox/Inviate/Bozze, chunk limitati e ripresa al giro successivo.

## Da fare

### 1. Login, utenti e installer

- [ ] Decisione architetturale: single-admin attuale oppure multi-utente reale.
- [ ] Tabella `users` con password hashata (PBKDF2/scrypt via WebCrypto).
- [ ] Sessione con `userId` e ruolo.
- [ ] `accounts.owner_user_id` + tabella di condivisione caselle.
- [ ] Filtro per utente in tutte le API, non solo nella UI.
- [ ] Installer/first-run per creare l'amministratore.
- [ ] Login con email + password, rate limiting e messaggi anti-enumerazione.
- [ ] Invito/aggiunta caselle sotto un account amministratore.

Il modello attuale (`APP_PASSWORD` unica) già dà accesso amministratore a tutte le caselle. Aggiungere solo il campo email sarebbe cosmetico senza isolamento lato API.

### 2. Pulsante “Deploy to Cloudflare”

- [ ] Valutare conversione a Worker con asset statici oppure template Pages dedicato.
- [ ] Configurazione guidata dei binding D1 (`DB`) e R2 (`BUCKET`).
- [ ] Prompt/secrets per `APP_PASSWORD` e `TOKEN_ENC_KEY`.
- [ ] Badge “Deploy to Cloudflare” nel README con istruzioni post-deploy.

Con Pages Functions + D1 + secret il pulsante non sarebbe davvero un click unico: oggi la Git integration resta il percorso più affidabile.

### 3. Miglioramenti successivi

- [ ] Notifiche in-app per nuovi messaggi mentre l'app è aperta.
- [ ] Firma HTML oltre al testo semplice.
- [ ] Etichette con rinomina/colore modificabile dalla UI.
- [ ] Ricerca server-side invece che client-side.
- [ ] Alias “send as”.

## Ordine consigliato

1. Login multi-utente/installer.
2. Deploy button.
