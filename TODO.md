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
- [x] Rebrand completo in `whelkmail`: nome prodotto, titolo pagina, package, documentazione, logo e favicon con conchiglia di buccina.
- [x] Sync metadati IMAP in D1: incrementale, chunked/resumable, `UIDVALIDITY`, cartelle speciali, trasferimento etichette sui movimenti e stato/errore in Impostazioni.

## Da fare

### 1. Rifiniture sync

- [ ] Archiviazione di corpi e allegati IMAP su R2 (opzionale ma consigliata).
- [ ] Sincronizzazione di cartelle personalizzate oltre Inbox/Inviate/Bozze.
- [ ] Sync automatica in background (dipende dal Worker schedulato).
- [ ] Avanzamento in tempo reale e ripresa automatica della sync parziale.

Prerequisito per notifiche push e forward automatico.

### 2. Webapp / PWA e notifiche

- [ ] `manifest.webmanifest` e icone.
- [ ] Service worker per app shell e caching statico (mai cache delle API).
- [ ] Web Push con VAPID e tabella D1 delle subscription.
- [ ] Worker schedulato per polling IMAP e invio push sui nuovi messaggi.
- [ ] Preferenze notifiche per account/cartella.
- [ ] Gestione permessi negati e revoca subscription.

Nota: senza IMAP IDLE serve polling server-side; dipende dalla sync completa.

### 3. Forward automatico con etichetta

- [ ] Tabella D1 `forward_rules` (account, etichetta, destinatari, enabled, created_at).
- [ ] Worker schedulato che processa solo i nuovi UID.
- [ ] Applicazione delle etichette ai nuovi messaggi in arrivo.
- [ ] Inoltro via SMTP dell'account o relay configurato.
- [ ] Anti-loop (non inoltrare messaggi generati dall'app, header dedicato).
- [ ] Log delle esecuzioni e stato per regola.
- [ ] UI di gestione regole nelle impostazioni.

Dipende dalla sync completa e dal worker schedulato.

### 4. Elimina email dal provider originale

- [ ] Flag account `delete_after_archive`, default disattivato.
- [ ] Attivazione solo dopo archivio locale verificato.
- [ ] Spostamento nel cestino del provider invece di cancellazione definitiva.
- [ ] Conferma esplicita e avviso irreversibilità.
- [ ] Log delle operazioni e possibilità di disattivare in ogni momento.

Da non abilitare finché la sync/archiviazione non è stabile.

### 5. Login, utenti e installer

- [ ] Decisione architetturale: single-admin attuale oppure multi-utente reale.
- [ ] Tabella `users` con password hashata (PBKDF2/scrypt via WebCrypto).
- [ ] Sessione con `userId` e ruolo.
- [ ] `accounts.owner_user_id` + tabella di condivisione caselle.
- [ ] Filtro per utente in tutte le API, non solo nella UI.
- [ ] Installer/first-run per creare l'amministratore.
- [ ] Login con email + password, rate limiting e messaggi anti-enumerazione.
- [ ] Invito/aggiunta caselle sotto un account amministratore.

Il modello attuale (`APP_PASSWORD` unica) già dà accesso amministratore a tutte le caselle. Aggiungere solo il campo email sarebbe cosmetico senza isolamento lato API.

### 6. Pulsante “Deploy to Cloudflare”

- [ ] Valutare conversione a Worker con asset statici oppure template Pages dedicato.
- [ ] Configurazione guidata dei binding D1 (`DB`) e R2 (`BUCKET`).
- [ ] Prompt/secrets per `APP_PASSWORD` e `TOKEN_ENC_KEY`.
- [ ] Badge “Deploy to Cloudflare” nel README con istruzioni post-deploy.

Con Pages Functions + D1 + secret il pulsante non sarebbe davvero un click unico: oggi la Git integration resta il percorso più affidabile.

### 7. Miglioramenti successivi

- [ ] Notifiche in-app per nuovi messaggi mentre l'app è aperta.
- [ ] Firma HTML oltre al testo semplice.
- [ ] Etichette con rinomina/colore modificabile dalla UI.
- [ ] Ricerca server-side invece che client-side.
- [ ] Alias “send as”.

## Ordine consigliato

1. Rifiniture sync (R2 e background).
2. PWA e notifiche push.
3. Forward automatico.
4. Eliminazione dal provider.
5. Login multi-utente/installer.
6. Deploy button.
