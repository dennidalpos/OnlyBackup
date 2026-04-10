# AGENTS.md

Linee guida operative per agenti automatici e strumenti di coding assistito.

## 1. Obiettivo

Lavorare in modo deterministico, verificabile e coerente con il repository reale.

Le regole devono restare proporzionate alla dimensione del progetto:
- all’inizio: semplicità, chiarezza, velocità controllata;
- durante la crescita: più formalizzazione solo quando serve davvero;
- sempre: evitare sia caos operativo sia overengineering.

Una regola nuova ha senso solo se migliora almeno uno tra:
- affidabilità;
- verificabilità;
- manutenibilità;
- scalabilità organizzativa;
- sicurezza;
- prevedibilità del rilascio.

---

## 2. Principi fondamentali

1. Conta prima il repository reale, non le assunzioni.
2. Non dichiarare mai verifiche non eseguite.
3. Segui prima le convenzioni native del progetto e dello stack.
4. Non introdurre pattern, naming, tool o strutture non giustificati dal repository.
5. Applica il minimo processo necessario, ma non meno di quello richiesto dal rischio reale.
6. Un task è chiuso solo dopo:
   - controllo finale;
   - aggiornamento tracking;
   - aggiornamento documentazione pertinente;
   - aggiornamento di `.gitignore`, se necessario;
   - verifica reale delle parti sensibili toccate.

---

## 3. Priorità delle fonti

In caso di conflitto, vale questo ordine:

1. repository reale;
2. codice, test, script e config eseguibili;
3. CI e automazioni;
4. documentazione in `docs/`;
5. `PROJECT_STATUS.json`;
6. `README.md`.

Regole:
- il comportamento reale del codice prevale sulla documentazione;
- la documentazione va riallineata al comportamento reale;
- `README.md` non è fonte tecnica primaria;
- se c’è drift chiaro e sicuro, correggilo.

---

## 4. Scope del lavoro

Quando utile, classifica il lavoro come:
- `core`: essenziale al prodotto;
- `supporting`: migliora qualità o operatività;
- `optional`: utile ma non necessario;
- `debt`: debito tecnico noto e accettato.

Regole:
- non espandere lo scope senza evidenza reale;
- non introdurre struttura “per il futuro” se non serve oggi;
- se accetti debito tecnico, dichiaralo nei residui o nel tracking;
- in fase MVP privilegia correttezza, semplicità e facilità di modifica.

---

## 5. Flusso operativo obbligatorio

Per ogni task:

1. ispeziona il repository reale;
2. identifica task attivo e stato del tracking;
3. valuta impatti diretti e indiretti;
4. classifica scope e rischio, se rilevante;
5. esegui modifiche minime ma complete;
6. verifica build, test, lint, packaging e CI se coinvolti;
7. aggiorna documentazione e tracking;
8. aggiorna `.gitignore` se le modifiche introducono o cambiano file generati, cache, log, artefatti, output locali o file macchina-specifici;
9. chiudi solo dopo controllo finale.

Prima di modificare qualsiasi file, verifica concretamente quando presenti:
- struttura directory;
- stack e toolchain;
- build, test, lint/format;
- CI/workflow;
- packaging/release/installers;
- `docs/`, `README.md`, tracking;
- naming e struttura già esistenti.

Non inventare struttura, script o workflow se il repository mostra già equivalenti.

---

## 6. Analisi d’impatto

Prima di modificare, identifica:
- file toccati direttamente;
- file impattati indirettamente;
- entrypoint coinvolti;
- test coinvolti;
- config coinvolte;
- workflow CI coinvolti;
- documentazione da aggiornare;
- eventuali impatti su compatibilità, sicurezza, dati o rilascio.

Ogni modifica va valutata anche per effetti collaterali.

---

## 7. Rischio della modifica

Classifica ogni task o modifica:

- `LOW`: docs, commenti, refactor isolato, rinomina locale sicura;
- `MEDIUM`: logica applicativa, refactor con impatto funzionale limitato;
- `HIGH`: dipendenze, build, CI, packaging, installer, entrypoint, config runtime/test, sicurezza, release, migrazioni, compatibilità pubblica.

Regole:
- `HIGH`: verifiche obbligatorie;
- `MEDIUM`: verifiche pertinenti fortemente raccomandate;
- `LOW`: verifica minima coerente con l’impatto reale.

Se una modifica può rompere qualcosa, trattala almeno come `MEDIUM`.

---

## 8. Regola di modifica

Applica la minima modifica sufficiente, ma completa tutto ciò che dipende dalla modifica:
- riferimenti;
- import;
- test;
- documentazione;
- tracking;
- script;
- configurazioni correlate;
- note di compatibilità o migrazione, se necessarie.

Non lasciare patch isolate o incoerenti.

---

## 9. Struttura del codice

Quando introduci o rifattorizzi codice, organizza preferibilmente in questo ordine:
1. dominio;
2. sottodominio;
3. ruolo tecnico;
4. file.

Obiettivi:
- evitare file monolitici;
- mantenere chiari i confini;
- favorire espandibilità;
- centralizzare logica condivisa solo quando il riuso è reale;
- ridurre duplicazioni e accoppiamento improprio.

Regole:
- se un file cresce troppo o mescola responsabilità, spezzalo per responsabilità reali;
- non continuare ad allargare file già troppo grandi;
- non introdurre astrazioni premature, layer inutili o pattern non giustificati;
- non creare contenitori generici senza responsabilità chiara.

---

## 10. File nuovi, script e dipendenze

### File nuovi
Ogni file nuovo deve:
- avere un tipo chiaro (`source`, `test`, `script`, `config`, `doc`, `asset`, `artifact`);
- stare vicino alla propria responsabilità;
- avere naming chiaro e coerente;
- aggiornare i riferimenti collegati;
- non creare duplicazioni o cartelle generiche inutili.

Evita cartelle come `misc`, `tmp`, `stuff`, `helpers` generici, se il progetto non le usa già con significato preciso.

### Script
Gli script devono:
- avere uno scopo chiaro;
- usare naming autoesplicativo;
- non richiedere parametri CLI per il flusso standard;
- non richiedere input manuale;
- essere separati se servono varianti di comportamento.

### Dipendenze
Prima di aggiungere una dipendenza valuta:
- problema reale che risolve;
- alternative già presenti;
- maturità e manutenzione;
- impatto su sicurezza, build, dimensione, licensing e lock-in.

Non aggiungere dipendenze per comodità marginale.

### `.gitignore`
`.gitignore` va mantenuto aggiornato.

Regole:
- ogni task che introduce output generati, cache, log, artefatti, file temporanei, file locali o output di tool deve includere una verifica esplicita di `.gitignore`;
- non chiudere un task che introduce nuovi file ricorrenti o rumore nel repository senza aver verificato se `.gitignore` va aggiornato;
- aggiorna `.gitignore` solo per output reali del repository e degli strumenti effettivamente usati;
- se vengono introdotti nuovi script, tool, build step, test runner o packaging output, verifica sempre l’impatto su `.gitignore`.

---

## 11. Testing, documentazione e tracking

### Testing
- testa prima ciò che è critico, fragile o riusato;
- non aggiungere test ornamentali;
- aggiorna i test se cambia il comportamento;
- se il rischio cresce e non esistono test, valuta almeno un test essenziale;
- se non ci sono test automatici, descrivi il controllo manuale con precisione.

### Documentazione
- `README.md`: breve, chiaro, orientato agli utenti;
- `docs/`: dettagli tecnici, operativi, testing, CI, release, decisioni;
- non duplicare quello che il codice mostra già chiaramente;
- se cambia il comportamento reale, aggiorna la documentazione pertinente;
- se cambia qualcosa di utente-facing, valuta aggiornamento anche di `README.md`.

### Tracking
Usa il sistema di tracking già presente nel repository.
Se presente, mantieni `PROJECT_STATUS.json` allineato.

Regole per `PROJECT_STATUS.json`:
- deve contenere solo task aperti, pianificati, bloccati o in corso;
- i task completati vanno rimossi; non serve storico nel tracking;
- ogni volta che viene definito o richiesto un piano, il piano va inserito nel task in forma dettagliata;
- il piano deve essere operativo e verificabile: passi, dipendenze, stato, verifiche previste e, quando noto, aree o file coinvolti;
- ogni task deve avere priorità relativa rispetto agli altri task presenti, non solo uno stato generico;
- la priorità va assegnata considerando almeno: blocchi attivi, dipendenze, impatto, rischio del ritardo e prontezza di implementazione;
- il tracking deve distinguere chiaramente tra piano, esecuzione reale, verifiche e residui;
- se dalla chiusura emergono follow-up reali, vanno creati come nuovi task aperti o documentati dove pertinente, non mantenuti come storico del task chiuso.

Un task non è completo se:
- non è verificato per la parte pertinente;
- lascia CI potenzialmente rotta;
- lascia documentazione necessaria non aggiornata;
- lascia residui non dichiarati;
- non aggiorna il tracking;
- non valuta `.gitignore` quando pertinente.

---

## 12. CI, qualità, sicurezza e release

Se tocchi file sensibili per build, test, lint, packaging o CI:
1. esegui i controlli pertinenti;
2. correggi eventuali rotture introdotte;
3. non chiudere il task lasciando problemi causati dalle modifiche;
4. dichiara con precisione cosa è stato verificato e cosa no.

Considera sensibili, se toccati:
- config build;
- test;
- lint/formatter;
- workflow CI;
- script di packaging/release/install;
- entrypoint;
- dipendenze e lockfile;
- config runtime/test;
- script usati dalla CI.

Sicurezza minima:
- non hardcodare segreti;
- documentare variabili ambiente richieste;
- evitare logging di dati sensibili;
- validare input e confini esterni quando rilevante.

Se il progetto produce pacchetti o installer:
- segui prima le convenzioni del repository;
- preferisci strumenti nativi quando coerenti;
- non introdurre breaking change silenziose;
- documenta i cambiamenti incompatibili.

---

## 13. Politica sulle verifiche dichiarate

Classifica sempre le verifiche come:

- `VERIFICATO`: eseguito realmente;
- `ISPEZIONATO`: controllato staticamente ma non eseguito;
- `NON VERIFICATO`: non eseguito;
- `NON VERIFICABILE`: non eseguibile nel contesto corrente.

Non usare formule ambigue come:
- “tutto verificato”;
- “CI sistemata” senza evidenza;
- “build ok” senza build reale;
- “compatibile” se è solo una deduzione.

---

## 14. Drift, legacy e consistenza

Correggi subito drift chiari e sicuri, soprattutto tra:
- codice e documentazione;
- configurazione e comportamento reale;
- script e flusso dichiarato;
- CI e istruzioni operative;
- tracking e stato effettivo.

Rimuovi codice legacy o morto solo se la rimozione è sicura e verificabile.
Se non lo è:
- non eliminarlo in modo speculativo;
- dichiaralo come residuo;
- documenta il debito tecnico se rilevante.

Non lasciare inconsistenze tra:
- codice e test;
- codice e docs;
- docs e README;
- script e flusso reale;
- tracking e stato effettivo.

---

## 15. Decisioni ed evoluzione del progetto

Formalizza una decisione in `docs/decisions/` quando:
- cambia una convenzione strutturale;
- introduce una dipendenza importante;
- modifica l’architettura di più moduli;
- introduce vincoli operativi o di rilascio;
- ha impatto su sicurezza, compatibilità o performance;
- sostituisce un comportamento precedente con trade-off non ovvi.

Documenta almeno:
- contesto;
- decisione;
- alternative considerate;
- motivazione;
- impatto atteso;
- costi o limiti.

Le regole devono crescere con il progetto:
- progetto piccolo/MVP: semplicità e verifiche essenziali;
- crescita iniziale: più copertura dei percorsi critici e più formalizzazione;
- progetto strutturato: CI più forte, decision log, policy di versioning e migrazione.

---

## 16. Regole in caso di incertezza

Se manca evidenza sufficiente:
- non assumere;
- non inventare;
- non dichiarare verifiche non eseguite;
- non imporre convenzioni estranee al progetto.

In caso di dubbio, prevalgono:
1. repository reale;
2. comportamento eseguibile;
3. convenzioni native del progetto.

---

## 17. Report finale obbligatorio

Alla fine di ogni task, riporta sempre:

1. file toccati;
2. cosa è stato modificato;
3. livello di rischio (`LOW` / `MEDIUM` / `HIGH`);
4. scope del lavoro, se utile (`core` / `supporting` / `optional` / `debt`);
5. verifiche realmente eseguite;
6. cosa non è stato verificato;
7. cosa non era verificabile;
8. eventuali residui;
9. aggiornamenti a `docs/`, `README.md`, `.gitignore` e `PROJECT_STATUS.json`.

Non presentare deduzioni come fatti.

---

## 18. Obiettivo finale

Ogni intervento deve lasciare il repository più:
- coerente;
- leggibile;
- verificabile;
- manutenibile;
- estendibile.

L’agente deve mantenere allineati:
- codice;
- struttura;
- documentazione;
- tracking;
- verifiche.

Per progetti piccoli che vogliono crescere, il successo è avere il giusto processo al momento giusto.