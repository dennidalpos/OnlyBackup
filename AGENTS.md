# AGENTS.md

Direttive operative per agenti che lavorano su repository software.

Obiettivo: eseguire modifiche piccole, corrette, verificabili e coerenti con il repository reale, minimizzando assunzioni, drift e output non controllati.

---

## 1. Principi non negoziabili

1. Conta il repository reale, non le assunzioni.
2. Non dichiarare mai verifiche non eseguite.
3. Applica la minima modifica sufficiente, ma completa tutto ciò che la modifica richiede.
4. Non introdurre naming, struttura, dipendenze, script o pattern non giustificati dal repository.
5. Un task non è chiuso finché codice, test, documentazione, tracking e `.gitignore` sono coerenti per la parte toccata.
6. Se qualcosa non è verificata, dichiaralo esplicitamente.
7. Se aumenta il rischio della modifica, aumenta il livello di verifica richiesto.
8. Mantieni il diff piccolo, leggibile e reviewabile.
9. Per dati personali, UI, configurazioni o flussi applicativi applica privacy by design e privacy by default.
10. In caso di dubbio, prevale sempre l’evidenza del repository.

---

## 2. Ordine di precedenza delle fonti

In caso di conflitto usa questo ordine:

1. repository reale;
2. codice, test, script e configurazioni eseguibili;
3. CI e automazioni;
4. documentazione tecnica (`docs/`);
5. tracking operativo (`PROJECT_STATUS.json` o equivalente), se presente;
6. `README.md`.

Regole:
- il comportamento reale del codice prevale sulla documentazione;
- `README.md` non è fonte tecnica primaria;
- se trovi drift chiaro e sicuro, correggilo.

---

## 3. Pre-check obbligatorio

Prima di modificare:

1. ispeziona la struttura reale del repository;
2. identifica stack, toolchain, shell e comandi disponibili;
3. individua file toccati, entrypoint, test, configurazioni, documentazione e CI coinvolti;
4. classifica scope e rischio;
5. determina il minimo set di modifiche necessarie.

Non iniziare a modificare finché non hai verificato, quando presenti:
- manifest e toolchain (`package.json`, `pyproject.toml`, `Cargo.toml`, `.csproj`, `go.mod`, ecc.);
- script di build, test, lint, format, typecheck;
- workflow CI;
- documentazione tecnica;
- tracking operativo;
- convenzioni di naming e struttura già in uso.

---

## 4. Scope e rischio

### Scope
- `core`: essenziale al prodotto;
- `supporting`: migliora qualità o operatività;
- `optional`: utile ma non necessario;
- `debt`: debito tecnico noto.

### Rischio
- `LOW`: documentazione, commenti, rinomina locale sicura, refactor isolato;
- `MEDIUM`: logica applicativa, test, configurazioni locali, refactor con impatto funzionale limitato;
- `HIGH`: dipendenze, build, CI, packaging, installer, entrypoint, config runtime/test, sicurezza, release, migrazioni, compatibilità pubblica.

Regola:
- se una modifica può rompere qualcosa e non è chiaramente innocua, trattala almeno come `MEDIUM`.

---

## 5. Discovery dei comandi

Prima di eseguire comandi, determina i comandi canonici del repository.

Ordine di ricerca:
1. script dichiarati nel repository;
2. task runner / Makefile / package scripts;
3. CI;
4. documentazione tecnica;
5. solo in assenza di evidenza: comando standard dello stack.

Regole:
- non inventare pipeline complesse;
- usa il minimo comando affidabile supportato dal repository;
- se il comando è dedotto e non esplicitamente dichiarato nel repo, dillo.

Se il repository mantiene questa sezione, aggiornala solo quando l’evidenza è chiara:

## Canonical commands
- setup:
- lint:
- format:
- typecheck:
- test:
- test:unit:
- test:integration:
- build:
- run:
- e2e:
- package:

Non inventare voci mancanti.

---

## 6. Ambiente e shell

### Default
Salvo evidenza contraria, lavora:
- nella directory del progetto o worktree corrente;
- con gli strumenti già usati dal repository;
- senza uscire dal perimetro del progetto.

### Windows / PowerShell
- preferisci comandi compatibili PowerShell;
- non assumere presenza di tool GNU o sintassi Bash;
- usa Bash solo se il repository lo richiede chiaramente o il task è in WSL;
- non mischiare PowerShell e Bash nello stesso task senza motivo reale.

### WSL / Linux
- resta coerente con tool e path Linux per tutto il task;
- non alternare WSL e PowerShell senza necessità verificata.

### Regole comuni
- preferisci path relativi al repository;
- evita operazioni distruttive fuori dal repository;
- usa quoting coerente con la shell reale.

---

## 7. Analisi d’impatto

Prima di modificare, identifica sempre:

- file toccati direttamente;
- file impattati indirettamente;
- entrypoint coinvolti;
- test coinvolti;
- configurazioni coinvolte;
- workflow CI coinvolti;
- documentazione da aggiornare;
- impatti su compatibilità, sicurezza, dati, packaging o rilascio.

Non fare patch isolate che lasciano riferimenti, import, tipi, test o documentazione incoerenti.

---

## 8. Regola di modifica

Ogni modifica deve essere:
- minima;
- completa;
- coerente con il repository;
- facile da revisionare.

Quando cambi qualcosa, aggiorna tutto ciò che dipende dalla modifica:
- riferimenti;
- import;
- tipi;
- test;
- documentazione;
- script;
- configurazioni correlate;
- tracking;
- note di compatibilità o migrazione, se necessarie.

Non introdurre:
- astrazioni premature;
- cartelle generiche senza responsabilità chiara;
- dipendenze per comodità marginale;
- file nuovi senza ruolo chiaro.

---

## 9. File nuovi, script e dipendenze

### File nuovi
Ogni file nuovo deve:
- avere un ruolo chiaro (`source`, `test`, `script`, `config`, `doc`, `asset`, `artifact`);
- stare vicino alla propria responsabilità;
- avere naming coerente con il repository;
- non duplicare responsabilità esistenti.

### Script
Ogni script deve:
- avere uno scopo chiaro;
- essere nominato in modo autoesplicativo;
- essere coerente con l’ambiente reale del progetto;
- essere idempotente quando possibile;
- non richiedere input manuale nei casi normali.

### Dipendenze
Prima di aggiungere una dipendenza valuta:
- problema reale che risolve;
- alternative già presenti;
- impatto su sicurezza, build, dimensione, licenza e lock-in.

Regola:
- non aggiungere dipendenze senza motivazione concreta e verificabile nel repository.

---

## 10. Packaging, setup e automazione installativa

Quando il task tocca packaging, installer, bootstrap dell’ambiente o distribuzione applicativa:

1. preferisci strumenti aperti e scriptabili già coerenti con il progetto;
2. su Windows, in assenza di vincoli contrari del repository, preferisci **Inno Setup** o **NSIS** per generare pacchetti di setup;
3. preferisci flussi completamente automatizzati rispetto a passaggi manuali;
4. fai gestire a script versionati nel repository:
   - verifica ambiente;
   - download delle dipendenze;
   - installazione;
   - upgrade;
   - eventuale bootstrap iniziale;
5. documenta prerequisiti, parametri e comportamento dei flussi automatizzati;
6. evita dipendenze installate manualmente quando possono essere recuperate e validate via script;
7. se il setup scarica componenti esterni, rendi espliciti:
   - origine del download;
   - versione attesa;
   - checksum o altra verifica di integrità, quando sensato;
   - comportamento in caso di errore o retry;
8. mantieni separati:
   - artefatto applicativo;
   - script di bootstrap;
   - logica di installazione/upgrade;
   - configurazione locale macchina-specifica.

Regole:
- non introdurre installer, updater o downloader ad hoc senza una chiara necessità;
- non chiudere un task di packaging lasciando non documentati i percorsi di installazione, upgrade o rollback;
- se il repository ha già uno strumento di packaging, prevale quello salvo problemi concreti e documentati.

---

## 11. Testing e verifiche

Testa prima ciò che è:
- critico;
- fragile;
- riusato;
- direttamente toccato.

Regole:
- se cambia il comportamento, aggiorna i test;
- se il rischio cresce e non esistono test, aggiungi almeno un controllo essenziale quando sensato;
- se non ci sono test automatici, descrivi il controllo manuale in modo preciso;
- per packaging/installazione, verifica almeno quando applicabile:
  - generazione dell’artefatto;
  - installazione pulita;
  - upgrade da versione precedente;
  - fallimento controllato in ambiente non valido.

### Stati ammessi per le verifiche
Usa solo questi stati:

- `VERIFICATO`: eseguito realmente;
- `ISPEZIONATO`: controllato staticamente ma non eseguito;
- `NON VERIFICATO`: non eseguito;
- `NON VERIFICABILE`: non eseguibile nel contesto corrente.

Non usare formule vaghe come:
- “tutto verificato”;
- “build ok” senza build reale;
- “CI sistemata” senza evidenza;
- “compatibile” se è solo una deduzione.

---

## 12. Documentazione, tracking e `.gitignore`

### Documentazione
- aggiorna la documentazione quando cambia il comportamento reale;
- usa `README.md` per istruzioni utente sintetiche;
- usa `docs/` per dettagli tecnici, operativi, test, CI, release e decisioni;
- non duplicare ciò che il codice mostra già chiaramente.

### Tracking
Usa il sistema di tracking già presente nel repository.
Se è presente `PROJECT_STATUS.json`, mantienilo coerente.

Regole:
- contiene solo task aperti, pianificati, bloccati o in corso;
- i task completati vanno rimossi;
- piano, esecuzione reale, verifiche e residui devono essere distinguibili.

### `.gitignore`
Ogni task che introduce:
- artefatti generati;
- cache;
- log;
- file temporanei;
- output locali di tool;
- file macchina-specifici

deve includere una verifica esplicita di `.gitignore`.

---

## 13. CI, build, release e sicurezza

Se tocchi file sensibili per build, test, lint, packaging, CI o release:

1. esegui i controlli pertinenti realmente disponibili;
2. correggi eventuali rotture introdotte;
3. non chiudere il task lasciando problemi causati dalle modifiche;
4. dichiara con precisione cosa è stato verificato e cosa no.

Considera sensibili:
- config build;
- workflow CI;
- entrypoint;
- dipendenze e lockfile;
- config runtime/test;
- script usati dalla CI;
- packaging, installer, updater e asset correlati.

Regole minime di sicurezza:
- non hardcodare segreti;
- documenta le variabili ambiente richieste;
- evita logging di dati sensibili;
- minimizza raccolta, persistenza ed esposizione dei dati;
- usa default conservativi, soprattutto su privacy e sicurezza;
- valida input, path, URL e confini esterni quando rilevante;
- verifica con particolare attenzione script che scaricano, installano o aggiornano componenti esterni.

---

## 14. Decisioni architetturali

Formalizza una decisione in `docs/decisions/` quando:
- cambia una convenzione strutturale;
- introduci una dipendenza importante;
- modifichi l’architettura di più moduli;
- introduci vincoli operativi o di rilascio;
- c’è impatto su sicurezza, privacy, compatibilità o performance;
- sostituisci un comportamento precedente con trade-off non ovvi.

Documenta almeno:
- contesto;
- decisione;
- alternative considerate;
- motivazione;
- impatto atteso;
- costi o limiti.

---

## 15. Regole in caso di incertezza

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

## 16. Final report obbligatorio

Alla fine di ogni task, riporta sempre questo blocco:

## Final report
- files_touched:
- what_changed:
- risk: LOW | MEDIUM | HIGH
- scope: core | supporting | optional | debt
- verified:
- inspected_only:
- not_verified:
- non_verifiable:
- residuals:
- docs_updated:
- readme_updated:
- gitignore_checked:
- project_status_updated:

Regole:
- non presentare deduzioni come fatti;
- separa chiaramente esecuzione, ispezione statica e limiti del contesto;
- ogni campo va compilato;
- se non hai verificato qualcosa, scrivilo esplicitamente.

---

## 17. Obiettivo finale

Ogni intervento deve lasciare il repository più:
- coerente;
- leggibile;
- verificabile;
- manutenibile.

L’agente deve mantenere allineati:
- codice;
- struttura;
- documentazione;
- tracking;
- verifiche.