# TODO

Stato al 2026-11-05. Le voci sono ordinate per dipendenza tecnica consigliata.

## Completato

- [x] Etichette personalizzate: creazione/eliminazione dalla sidebar, colori, assegnazione dal pannello di lettura e vista etichetta Gmail-style che raccoglie i messaggi da Inbox, Inviate e Bozze.
- [x] Firme: scelta tra firma unica per tutti gli account o firma diversa per ciascuno, inserimento automatico in nuove email e risposte.
- [x] Vista mobile: sidebar a scomparsa, topbar responsive, pannello di lettura a schermo intero.
- [x] Migrazione D1 per etichette/firme (`npm run db:migrate:remote`).

## Da fare

### 1. Rubrica contatti

- [ ] Tabella D1 `contacts` (id, nome, email, note, created_at).
- [ ] API CRUD `/api/contacts`.
- [ ] Pagina/sezione Rubrica con ricerca e modifica.
- [ ] Autocomplete destinatari nel composer (To/Cc/Bcc).
- [ ] Import/export contatti (vCard o CSV) — opzionale ma consigliato.
- [ ] Deduplica per indirizzo email, normalizzato in minuscolo.

Prossimo passo consigliato: indipendente dal resto, basso rischio.

### 2. Sync completa delle caselle

- [ ] Mirror dei metadati dei messaggi da IMAP a D1.
- [ ] Archiviazione di corpi e allegati su R2 (opzionale ma consigliata).
- [ ] Sincronizzazione di Posta in arrivo, Inviate e Bozze, non solo gli ultimi 30 messaggi.
- [ ] Gestione `UIDVALIDITY` e high-water mark per sync incrementale.
- [ ] Backfill a blocchi/cursore per evitare timeout e limiti CPU dei Worker.
- [ ] Mappatura delle cartelle speciali del provider.
- [ ] Etichette stabili quando un messaggio viene spostato tra cartelle (con il mirror locale).
- [ ] Stato/errore di sincronizzazione visibile nelle impostazioni.

Prerequisito per notifiche push, forward automatico e vista etichette globale.

### 3. Webapp / PWA e notifiche

- [ ] `manifest.webmanifest` e icone.
- [ ] Service worker per app shell e caching statico (mai cache delle API).
- [ ] Web Push con VAPID e tabella D1 delle subscription.
- [ ] Worker schedulato per polling IMAP e invio push sui nuovi messaggi.
- [ ] Preferenze notifiche per account/cartella.
- [ ] Gestione permessi negati e revoca subscription.

Nota: senza IMAP IDLE serve polling server-side; dipende dalla sync completa.

### 4. Forward automatico con etichetta

- [ ] Tabella D1 `forward_rules` (account, etichetta, destinatari, enabled, created_at).
- [ ] Worker schedulato che processa solo i nuovi UID.
- [ ] Applicazione delle etichette ai nuovi messaggi in arrivo.
- [ ] Inoltro via SMTP dell'account o relay configurato.
- [ ] Anti-loop (non inoltrare messaggi generati dall'app, header dedicato).
- [ ] Log delle esecuzioni e stato per regola.
- [ ] UI di gestione regole nelle impostazioni.

Dipende dalla sync completa e dal worker schedulato.

### 5. Elimina email dal provider originale

- [ ] Flag account `delete_after_archive`, default disattivato.
- [ ] Attivazione solo dopo archivio locale verificato.
- [ ] Spostamento nel cestino del provider invece di cancellazione definitiva.
- [ ] Conferma esplicita e avviso irreversibilità.
- [ ] Log delle operazioni e possibilità di disattivare in ogni momento.

Da non abilitare finché la sync/archiviazione non è stabile.

### 6. Login, utenti e installer

- [ ] Decisione architetturale: single-admin attuale oppure multi-utente reale.
- [ ] Tabella `users` con password hashata (PBKDF2/scrypt via WebCrypto).
- [ ] Sessione con `userId` e ruolo.
- [ ] `accounts.owner_user_id` + tabella di condivisione caselle.
- [ ] Filtro per utente in tutte le API, non solo nella UI.
- [ ] Installer/first-run per creare l'amministratore.
- [ ] Login con email + password, rate limiting e messaggi anti-enumerazione.
- [ ] Invito/aggiunta caselle sotto un account amministratore.

Il modello attuale (`APP_PASSWORD` unica) già dà accesso amministratore a tutte le caselle. Aggiungere solo il campo email sarebbe cosmetico senza isolamento lato API.

### 7. Pulsante “Deploy to Cloudflare”

- [ ] Valutare conversione a Worker con asset statici oppure template Pages dedicato.
- [ ] Configurazione guidata dei binding D1 (`DB`) e R2 (`BUCKET`).
- [ ] Prompt/secrets per `APP_PASSWORD` e `TOKEN_ENC_KEY`.
- [ ] Badge “Deploy to Cloudflare” nel README con istruzioni post-deploy.

Con Pages Functions + D1 + secret il pulsante non sarebbe davvero un click unico: oggi la Git integration resta il percorso più affidabile.

### 8. Miglioramenti successivi

- [ ] Notifiche in-app per nuovi messaggi mentre l'app è aperta.
- [ ] Firma HTML oltre al testo semplice.
- [ ] Etichette con rinomina/colore modificabile dalla UI.
- [ ] Ricerca server-side invece che client-side.
- [ ] Alias “send as”.

## Ordine consigliato

1. Rubrica.
2. Sync completa e mirror locale.
3. PWA e notifiche push.
4. Forward automatico.
5. Eliminazione dal provider.
6. Login multi-utente/installer.
7. Deploy button.
