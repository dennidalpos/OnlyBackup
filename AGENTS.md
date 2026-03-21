# AGENTS.md

## Scopo

Definire uno standard operativo riusabile per qualsiasi repository, utile sia come base per nuovi progetti sia per riallineare repository esistenti.

L'agente deve privilegiare modifiche:
- sicure;
- verificabili;
- conservative in caso di dubbio;
- coerenti con lo stato reale del repository;
- minime rispetto al perimetro richiesto;
- riusabili tra stack e progetti diversi.

Obiettivo finale: lasciare ogni repository in uno stato pulito, prevedibile, documentato e allineato agli standard comuni.

---

## Modello di applicazione

Questo file definisce uno standard a livelli.

### Livello 1 — regole sempre valide
Valgono per tutti i repository.

### Livello 2 — regole applicabili se pertinenti
Valgono solo se il repository presenta davvero quel caso, ad esempio:
- monorepo;
- packaging;
- publish/deploy;
- servizi Windows;
- installer MSI;
- tooling locale;
- componenti distribuibili.

### Livello 3 — regole specifiche di progetto
Devono emergere dal repository reale e dalla sua documentazione.
Non vanno inventate in assenza di evidenza concreta.

---

## Principi non negoziabili

1. Stesso input e stesso stato del repository devono produrre lo stesso output.
2. I comandi devono essere non interattivi, salvo richiesta esplicita contraria.
3. I path devono essere relativi alla root del repository o dichiarati esplicitamente.
4. Gli output generati devono finire solo in directory previste.
5. Nessuna operazione deve dipendere da stato locale implicito non documentato.
6. Naming, ordinamenti e layout dei file generati devono essere stabili.
7. I file testuali generati o aggiornati devono usare encoding e newline coerenti con il repository.
8. Timestamp, date o metadati volatili vanno evitati salvo requisito esplicito.
9. I comandi devono restituire exit code coerenti.
10. CI e uso locale devono usare gli stessi entrypoint logici, salvo eccezioni documentate.
11. In caso di dubbio si preferisce la soluzione più conservativa.
12. Non si amplia inutilmente il perimetro delle modifiche.
13. I progetti devono essere costruiti fin dall'inizio separando i file per responsabilità. Ogni file deve avere uno scopo chiaro, limitato e coerente, evitando accorpamenti che portino nel tempo a file troppo grandi, difficili da mantenere o con troppe responsabilità. Quando una parte evolve in modo autonomo, va estratta in un file o modulo dedicato.

---

## Priorità di verità

In caso di conflitto, l'ordine di priorità è:

1. repository reale;
2. codice, test, script e configurazioni eseguibili;
3. specifiche o documentazione tecnica di progetto;
4. stato operativo dichiarato;
5. README o documentazione introduttiva.

Il drift non va ignorato:
- correggerlo subito se la correzione è chiara, sicura e limitata;
- altrimenti registrarlo nel meccanismo di tracking del repository.

---

## Politica di modifica

L'agente deve:
1. osservare prima lo stato reale del repository;
2. derivare la soluzione minima coerente con quello stato;
3. preservare stack, convenzioni e struttura già consolidate, salvo forte evidenza contraria;
4. evitare refactor non richiesti;
5. mantenere allineati codice, script, documentazione, output generati e configurazione;
6. non introdurre file o directory standard se non servono davvero al progetto;
7. non lasciare artefatti temporanei o output di compilazione come stato persistente, salvo richiesta esplicita.

---

## File di governo

Nella root devono esistere sempre:

```text
AGENTS.md
README.md
.gitignore
```

Sono obbligatori quando servono davvero al governo del repository:

```text
PROJECT_SPEC.md
PROJECT_STATUS.json
LICENSE
```

### Regole
- `PROJECT_SPEC.md` serve quando il comportamento atteso non è ricavabile facilmente dal codice o dal README.
- `PROJECT_STATUS.json` serve quando esistono flussi operativi, task aperti o stato tecnico che conviene tracciare in modo strutturato.
- `LICENSE` serve solo se il repository distribuisce codice, artefatti o documentazione con una policy di licenza esplicita.
- Se uno di questi file manca ma è necessario, va creato in forma minima, concreta e coerente.
- Se non è necessario, non va introdotto solo per rigidità formale.

---

## Documenti standard

### `README.md`
Documento orientato agli utenti. Deve descrivere, se applicabili:
- scopo del progetto;
- requisiti;
- setup;
- comandi principali;
- build;
- run;
- test;
- packaging;
- publish o deploy;
- clean;
- struttura essenziale;
- note di licenza.

### `PROJECT_SPEC.md`
Contiene solo elementi di specifica:
- obiettivi;
- architettura;
- comportamento atteso;
- vincoli.

Non contiene task operativi.

### `PROJECT_STATUS.json`
Contiene solo stato operativo utile e mantenibile.

Schema minimo consigliato:

```json
{
  "schema_version": 1,
  "repo_type": "single | monorepo",
  "stack": [],
  "artifacts_root": "artifacts",
  "commands": {
    "bootstrap": "scripts/bootstrap",
    "doctor": "scripts/doctor",
    "compile": "scripts/compile",
    "build": "scripts/build",
    "test": "scripts/test",
    "pack": "scripts/pack",
    "publish": "scripts/publish",
    "clean": "scripts/clean"
  },
  "tasks": []
}
```

Regole:
- registrare solo informazioni utili e mantenibili;
- evitare inventari manuali fragili o ridondanti;
- usare `tasks` solo per problemi aperti, specifici e verificabili;
- rimuovere i task completati;
- non usare il file come diario.

Schema task minimo:

```json
{
  "id": "task-name",
  "type": "bug | refactor | doc | infra | drift",
  "status": "pending | in_progress",
  "description": "descrizione",
  "files": ["file1"],
  "priority": 1
}
```

---

## Interfaccia operativa canonica

Ogni repository dovrebbe esporre, direttamente o tramite wrapper, questi entrypoint logici quando applicabili:

```text
bootstrap
doctor
compile
build
test
pack
publish
clean
```

### Regole
1. Gli entrypoint devono essere pochi, stabili e documentati.
2. Possono essere implementati con lo stack più adatto: shell, PowerShell, Python, Node, Make, dotnet, cargo o altro.
3. README e CI devono richiamare gli stessi entrypoint logici.
4. Non devono esistere più meccanismi concorrenti per lo stesso flusso senza una chiara fonte di verità.
5. Se esistono wrapper e comandi nativi dello stack, il wrapper canonico è la fonte di verità operativa.
6. Se un comando non è pertinente per quel repository, va dichiarato esplicitamente e non simulato.

---

## Semantica dei comandi

### `bootstrap`
Prepara l'ambiente locale minimo:
- dipendenze di progetto;
- tool locali richiesti;
- file o cartelle locali necessarie ma non versionate.

Non deve pubblicare artefatti finali.

### `doctor`
Verifica prerequisiti e coerenza dell'ambiente:
- toolchain;
- versioni richieste;
- configurazioni minime;
- dipendenze esterne dichiarate.

Non deve modificare il repository salvo cache o file temporanei dichiarati.

### `compile`
Produce output compilati o trasformati necessari all'esecuzione tecnica, senza packaging finale.

### `build`
Esegue `compile` e i passaggi tecnici necessari per ottenere un risultato locale completo e verificabile.

### `test`
Esegue i test automatici e, quando pertinenti, smoke test di avvio. I report devono essere salvati solo in directory previste.

### `pack`
Produce artefatti distribuibili o installabili.

### `publish`
Pubblica, esporta o deposita quanto prodotto da `pack` verso una destinazione prevista.

`publish` non deve ridefinire in modo implicito il processo di build.

### `clean`
Rimuove solo output generati e cache locali previste, riportando il repository a uno stato sorgente-only compatibile con i file versionati.

Non deve cancellare:
- sorgenti;
- test;
- documentazione;
- configurazioni versionate;
- file di governo.

---

## Struttura standard del repository

Struttura di riferimento per un repository singolo:

```text
/
├── AGENTS.md
├── README.md
├── .gitignore
├── PROJECT_SPEC.md
├── PROJECT_STATUS.json
├── LICENSE
├── /src
├── /tests
├── /scripts
├── /docs
├── /config
├── /tools
├── /examples
└── /artifacts
```

Non tutte queste directory devono esistere sempre.
Creare solo quelle realmente giustificate.

### Regole di layout
1. Il sorgente sta in `/src` quando lo stack lo consente senza forzature artificiali.
2. I test stanno in `/tests` quando separabili chiaramente dal sorgente.
3. Gli script standard stanno in `/scripts`.
4. Gli output generati persistenti stanno sotto `/artifacts` quando controllabili dal repository.
5. Gli output non devono finire dentro `/src`, `/tests`, `/docs` o `/config`.
6. La root deve restare pulita e leggibile.
7. Se lo stack impone layout diversi, si segue lo stack ma si documenta l'eccezione.

---

## Tassonomia artefatti

La root `artifacts/` dovrebbe usare una tassonomia chiara e prevedibile:

```text
/artifacts
  /build
  /test-results
  /packages
  /publish
  /logs
```

Regole:
1. `compile` e `build` scrivono in `artifacts/build` quando possibile.
2. `test` scrive report in `artifacts/test-results`.
3. `pack` scrive in `artifacts/packages`.
4. `publish` scrive output locali o manifest in `artifacts/publish` quando applicabile.
5. I log persistenti stanno in `artifacts/logs`.
6. Se lo stack genera output fuori da `artifacts`, questi output devono essere documentati, ignorati da git e coperti da `clean`.

---

## Repo singolo e monorepo

### Repo singolo
La struttura standard si applica direttamente alla root.

### Monorepo
Per un monorepo, la convenzione top-level consigliata è:

```text
/apps
/packages
/scripts
/docs
/config
/artifacts
```

Regole:
1. usare `apps/` per elementi eseguibili o deployabili;
2. usare `packages/` per componenti riusabili;
3. evitare naming top-level concorrenti senza una motivazione documentata;
4. ogni unità interna deve rispettare in piccolo lo stesso standard, per quanto compatibile.

Esempio:

```text
/apps/app-a/src
/apps/app-a/tests
/apps/app-a/README.md
/packages/pkg-a/src
/packages/pkg-a/tests
/packages/pkg-a/README.md
```

---

## Gestione del drift

Per drift si intende qualsiasi incoerenza tra:
- codice;
- configurazione;
- script;
- documentazione;
- stato operativo;
- output attesi.

Quando il drift viene rilevato:
1. correggerlo subito se la correzione è chiara, sicura e limitata;
2. altrimenti registrarlo nel meccanismo di tracking previsto;
3. aggiornare i documenti coinvolti in modo minimo ma coerente.

Esempi di drift:
- comandi documentati che non esistono;
- output generati in percorsi incoerenti;
- `README.md` non coerente con il comportamento reale;
- `.gitignore` incompleto rispetto agli artefatti generati;
- stato operativo non coerente con gli entrypoint reali.

---

## `.gitignore`

L'agente deve verificare `.gitignore`.

Regole:
1. se manca, crearlo;
2. se esiste, aggiornarlo in coerenza con lo stack reale;
3. escludere tutti gli artefatti generati che non devono essere versionati;
4. mantenere `.gitignore`, output reali, `clean` e documentazione coerenti.

Percorsi tipici da ignorare, se pertinenti:

```text
artifacts/
bin/
obj/
dist/
out/
publish/
target/
tmp/
.vscode/
.idea/
.DS_Store
Thumbs.db
*.log
```

---

## LICENSE

L'agente deve verificare `LICENSE` solo se il repository richiede una policy di licenza esplicita.

Vincoli:
1. non imporre autore, anno o tipo di licenza hardcoded;
2. non introdurre una licenza proprietaria per default;
3. non lasciare placeholder nel file finale;
4. allineare eventuali riferimenti nel `README.md`.

---

## Regole condizionali per Windows, MSI e servizi

Questa sezione si applica solo se il repository contiene un'applicazione Windows installabile, un installer MSI, script di setup Windows o servizi installabili localmente.

### Regole
1. usare prima gli strumenti già presenti nel repository;
2. introdurre tool locali solo se davvero necessari e documentati;
3. installazione, upgrade, uninstall e cleanup devono essere verificabili tramite script;
4. i test non devono lasciare servizi installati o installazioni locali attive;
5. log di installazione e uninstall devono finire in `artifacts/logs` quando persistenti;
6. usare strumenti nativi Windows per la gestione servizi quando possibile;
7. usare NSSM solo come fallback esplicito e documentato.

---

## Modalità operative

### Bootstrap di un repo nuovo
Obiettivo:
- creare la struttura minima utile;
- definire entrypoint canonici;
- impostare README, `.gitignore` e file di governo necessari;
- evitare over-engineering iniziale.

### Allineamento di un repo esistente
Obiettivo:
- confrontare il repository con questo standard;
- correggere il drift chiaro e limitato;
- introdurre solo ciò che serve davvero;
- non riscrivere il repository senza necessità.

### Light Mode
Usare per modifiche locali o mirate.

Minimo richiesto:
- verificare l'area modificata;
- correggere drift locale evidente;
- aggiornare documentazione minima se necessario.

### Full Sync Mode
Usare per:
- refactor strutturali;
- riorganizzazione repository;
- riallineamento documentazione;
- normalizzazione di struttura, script, build, test, pack, publish, clean, `LICENSE` o `.gitignore`.

Minimo richiesto:
- verificare gli entrypoint canonici;
- verificare la root `artifacts` se pertinente;
- riallineare script, documentazione e stato;
- aggiornare lo stato operativo se cambiano i flussi reali.

---

## Verifica minima obbligatoria

Quando vengono creati o aggiornati script operativi, l'agente deve testare i flussi reali per quanto eseguibile nel contesto corrente.

Sequenza minima, se pertinente:
1. eseguire `clean`;
2. eseguire `bootstrap` e `doctor` se previsti;
3. eseguire gli script aggiornati o generati;
4. eseguire `build` e `test`;
5. eseguire almeno uno smoke test di avvio se l'app è eseguibile localmente;
6. rieseguire `clean` al termine;
7. lasciare il repository pulito.

Se un passaggio non è eseguibile nel contesto corrente, va dichiarato esplicitamente e non simulato come eseguito.

---

## Checklist finale

Per ogni modifica, se pertinente, verificare:
1. coerenza tra codice, script e documentazione;
2. presenza e coerenza di `README.md`;
3. presenza e coerenza di `.gitignore`;
4. correttezza degli entrypoint realmente applicabili;
5. separazione corretta tra sorgente, test, script, documentazione, configurazione e output;
6. corretto confinamento degli output sotto `artifacts/`, quando possibile;
7. stato finale pulito del repository;
8. assenza di residui di test o installazione;
9. assenza di requisiti inventati;
10. allineamento del repository agli standard comuni senza forzature inutili.

Obiettivo: lasciare il repository in uno stato pulito, coerente, standardizzato e scalabile, mantenendo però compatibilità con lo stack e con la realtà del progetto.
