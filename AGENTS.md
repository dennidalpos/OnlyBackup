# AGENTS.md

## Scopo

Definire uno standard operativo **deterministico**, riusabile e scalabile per qualsiasi repository.

L’agente deve privilegiare modifiche:
- sicure;
- verificabili;
- conservative in caso di dubbio;
- coerenti con lo stato reale del repository;
- minimali rispetto al perimetro richiesto.

Obiettivo finale: lasciare ogni repository in uno stato pulito, prevedibile, documentato e automatizzabile.

---

## Principi di determinismo

Le operazioni sul repository devono essere deterministiche.

Regole obbligatorie:
1. stesso input e stesso stato del repository devono produrre lo stesso output;
2. i comandi devono essere non interattivi, salvo esplicita richiesta contraria;
3. i path devono essere relativi alla root del repository o dichiarati in modo esplicito;
4. gli output generati devono finire solo in directory previste;
5. nessuna operazione deve dipendere da stato locale implicito non documentato;
6. ordinamenti, naming e layout dei file generati devono essere stabili;
7. file testuali generati o aggiornati devono usare UTF-8 e newline coerenti con il repository;
8. date, orari o timestamp nei file generati vanno evitati salvo requisito esplicito;
9. i comandi devono restituire exit code coerenti;
10. CI e uso locale devono passare dagli stessi entrypoint, salvo eccezioni documentate.

---

## Priorità di verità

In caso di conflitto, l’ordine di priorità è:

1. repository reale;
2. script, test e configurazioni eseguibili;
3. `PROJECT_SPEC.md`;
4. `PROJECT_STATUS.json`;
5. `README.md`.

Il drift non va ignorato:
- correggerlo subito se la soluzione è chiara, sicura e limitata;
- altrimenti registrarlo in `PROJECT_STATUS.json`.

---

## Regole obbligatorie

1. Codice, configurazione, script, documentazione e stato del progetto devono restare coerenti.
2. Non inventare requisiti non supportati dal repository.
3. In caso di dubbio preferire la soluzione conservativa.
4. Rispettare stack, convenzioni e struttura già consolidate, salvo forte evidenza contraria.
5. Build, test, pack, publish, clean, `.gitignore`, `README.md` e output generati devono restare allineati.
6. Non lasciare nel repository artefatti temporanei o di compilazione come stato persistente, salvo richiesta esplicita.
7. Mantenere separazione chiara tra sorgente, test, script, documentazione, configurazione e output.
8. Non ampliare inutilmente il perimetro delle modifiche.
9. Tutti i flussi operativi principali devono essere raggiungibili tramite entrypoint stabili.
10. La root del repository deve restare pulita e leggibile.
11. Dopo i test il repository deve tornare in stato pulito, senza servizi installati localmente, senza installer attivi e senza residui non necessari.

---

## File di governo

Quando applicabili e necessari al corretto governo del repository, nella root devono esistere almeno:

```text
AGENTS.md
PROJECT_SPEC.md
PROJECT_STATUS.json
README.md
.gitignore
```

`LICENSE` è obbligatoria solo se il repository distribuisce codice, artefatti o documentazione con una policy di licenza esplicita.

Se uno di questi file manca e serve davvero al progetto, va creato in forma minima e coerente.

---

## Documenti standard

### `PROJECT_SPEC.md`
Contiene:
- obiettivi;
- architettura;
- comportamento atteso;
- vincoli.

Non contiene task operativi.

### `PROJECT_STATUS.json`
Contiene solo stato operativo minimo e informazioni utili alla manutenzione.

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
- inserire in `tasks` solo problemi aperti, specifici e verificabili;
- rimuovere i task completati;
- non usare `PROJECT_STATUS.json` come diario.

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

### `README.md`
Documento orientato agli utenti. Deve descrivere, se applicabili:
- scopo del progetto;
- requisiti;
- setup;
- comandi principali;
- build;
- run;
- test;
- pack o packaging;
- publish o deploy;
- clean;
- struttura essenziale;
- note sulla licenza.

---

## Gestione drift

Per drift si intende ogni incoerenza tra:
- codice;
- configurazione;
- script;
- documentazione;
- stato del progetto;
- output attesi.

Quando il drift viene rilevato:
1. correggerlo subito se la correzione è chiara, sicura e limitata;
2. altrimenti creare un task in `PROJECT_STATUS.json`;
3. aggiornare i documenti coinvolti in modo minimo ma coerente.

Esempi:
- comandi documentati non esistenti;
- output generati in percorsi incoerenti;
- `README.md` non coerente con il comportamento reale;
- `.gitignore` incompleto rispetto agli artefatti generati;
- `PROJECT_STATUS.json` non coerente con gli entrypoint reali.

---

## Interfaccia operativa canonica

Ogni repository deve esporre, direttamente o tramite wrapper, gli stessi entrypoint logici:

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

Gli entrypoint possono essere implementati con lo stack più adatto (`make`, shell, PowerShell, Python, Node, dotnet, cargo, ecc.), ma devono essere stabili, documentati e richiamabili in modo uniforme.

Se il repository usa una directory `scripts/`, la struttura consigliata è:

```text
/scripts
  bootstrap
  doctor
  compile
  build
  test
  pack
  publish
  clean
  /helpers
```

Per packaging Windows o installazione locale si possono aggiungere sottocartelle specialistiche, mantenendo invariati gli entrypoint canonici:

```text
/scripts
  /helpers
  /packaging
    msi-build
    msi-install-test
    msi-upgrade-test
    msi-uninstall-test
  /windows
    service-install
    service-uninstall
    services-cleanup
    nssm-cleanup
```

Per repository Windows che includono strumenti locali, la struttura consigliata è:

```text
/tools
  /wix314-binaries
  /nssm
```

Regole:
1. gli entrypoint esposti devono essere pochi e stabili;
2. helper, diagnostica e flussi specialistici vanno in sottocartelle dedicate;
3. README e CI devono usare gli stessi entrypoint;
4. non esporre in root più meccanismi concorrenti per lo stesso flusso;
5. se esistono wrapper e comandi nativi di stack, il wrapper canonico è la fonte di verità operativa.

---

## Semantica obbligatoria dei comandi

### `bootstrap`
Prepara l’ambiente locale minimo:
- dipendenze di progetto;
- tool locali richiesti;
- file o cartelle locali necessarie ma non versionate.

Non deve pubblicare artefatti finali.

### `doctor`
Verifica prerequisiti e coerenza dell’ambiente:
- toolchain presente;
- versioni richieste;
- configurazioni minime;
- eventuali dipendenze esterne dichiarate.

Non deve modificare il repository salvo cache o file temporanei dichiarati.

### `compile`
Produce output compilati o trasformati necessari all’esecuzione tecnica, senza packaging finale.

### `build`
Esegue `compile` e tutti i passaggi tecnici necessari per ottenere un risultato locale completo e verificabile.

### `test`
Esegue i test automatici, esegue quando pertinenti gli smoke test di avvio applicazione e salva report solo in directory previste.

### `pack`
Produce artefatti distribuibili o installabili.

Se l’applicazione è distribuibile tramite MSI su Windows, `pack` deve generare o aggiornare anche gli script di packaging necessari per creare l’MSI in modo ripetibile.

### `publish`
Pubblica, esporta o deposita quanto prodotto da `pack` verso una destinazione prevista.

`publish` non deve ridefinire in modo implicito il processo di build.

### `clean`
Rimuove solo output generati e cache locali previste, riportando il repository a uno stato sorgente-only compatibile con i file versionati.

`clean` non deve cancellare:
- sorgenti;
- test;
- documentazione;
- configurazioni versionate;
- file di governo.

`clean` deve anche includere, se pertinenti:
- rimozione di installazioni locali usate per test;
- rimozione di servizi Windows o NSSM creati durante i test;
- rimozione di file residui lasciati da setup, upgrade o uninstall test;
- rimozione di output fuori da `artifacts/` generati inevitabilmente dallo stack.

---

## Struttura standard del repository

Struttura di riferimento per un repository singolo:

```text
/
├── AGENTS.md
├── PROJECT_SPEC.md
├── PROJECT_STATUS.json
├── README.md
├── LICENSE
├── .gitignore
├── /src
├── /tests
├── /scripts
├── /docs
├── /config
├── /tools
├── /examples
└── /artifacts
```

Non tutte queste directory devono esistere sempre: creare solo quelle realmente giustificate.

### Regole di struttura
- `/src`: codice sorgente principale versionato.
- `/tests`: test automatizzati, fixture e dati di test.
- `/scripts`: entrypoint operativi del repository.
- `/docs`: documentazione tecnica o utente non adatta al README.
- `/config`: configurazioni condivise non già gestite chiaramente dallo stack.
- `/tools`: utility di sviluppo o manutenzione non entrypoint.
- `/examples`: esempi minimi di utilizzo.
- `/artifacts`: unica root per output generati persistenti locali o di CI.

### Regole obbligatorie di layout
1. Il sorgente sta in `/src`.
2. I test stanno in `/tests`.
3. Gli script standard stanno in `/scripts`.
4. Gli output generati persistenti stanno sotto `/artifacts`.
5. Gli output non devono finire dentro `/src`, `/tests`, `/docs` o `/config`.
6. La root deve contenere solo file di governo, manifest principali, entrypoint top-level strettamente necessari e directory standard di primo livello.

---

## Tassonomia artefatti

La root `artifacts/` deve usare una tassonomia chiara e prevedibile.

Struttura consigliata:

```text
/artifacts
  /build
  /test-results
  /packages
  /publish
  /logs
```

Regole:
1. `compile` e `build` scrivono in `artifacts/build`;
2. `test` scrive report in `artifacts/test-results`;
3. `pack` scrive in `artifacts/packages`;
4. `publish` scrive output locali o manifest in `artifacts/publish` quando applicabile;
5. log persistenti di processo stanno in `artifacts/logs`;
6. non lasciare output persistenti in `bin/`, `obj/`, `dist/`, `out/`, `target/`, `publish/` o percorsi equivalenti fuori da `artifacts/`, salvo vincoli di stack non evitabili.

Se lo stack genera directory temporanee inevitabili fuori da `artifacts/`, devono essere:
- note;
- ignorate da git;
- coperte da `clean`.

---

## Repo singolo e monorepo

### Repo singolo
La struttura standard si applica direttamente alla root.

### Monorepo
Per un monorepo, usare solo la seguente convenzione top-level:

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
3. non mischiare naming top-level alternativi come `libs`, `services`, `projects` salvo eccezione documentata;
4. ogni unità interna deve rispettare in piccolo lo stesso standard.

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

## `.gitignore`

L’agente deve verificare `.gitignore`.

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

L’agente deve verificare `LICENSE` solo se il repository richiede una policy di licenza esplicita.

Procedura:
1. rilevare se il repository mostra già una licenza valida;
2. se manca ma serve, crearla;
3. se esiste ma non è coerente con il repository, aggiornarla;
4. allineare eventuali riferimenti in `README.md`.

Vincoli:
- non imporre autore, anno o tipo di licenza hardcoded;
- non introdurre una licenza proprietaria per default;
- non lasciare placeholder nel file finale.

---

## Packaging MSI e servizi Windows

Questa sezione è obbligatoria quando il repository contiene un’applicazione Windows installabile, un installer MSI, script di setup Windows o servizi installabili localmente.

### Regole obbligatorie
1. generare o aggiornare gli script per la creazione dell’MSI dell’app quando il repository supporta packaging Windows;
2. per la generazione MSI usare in priorità gli strumenti già presenti nel repository; se non sono presenti altri strumenti, usare `\tools\wix314-binaries` come toolchain locale di default;
3. gli script MSI devono supportare installazione iniziale, futuri aggiornamenti, disinstallazione e pulizia residui;
4. gli script devono prevedere la rimozione di file residui, directory residue, task pianificati e servizi collegati all’app quando pertinenti;
5. se l’app installa o può installare servizi Windows, privilegiare la creazione e gestione del servizio tramite comandi nativi Windows e script dedicati di installazione e disinstallazione;
6. gli script di servizio devono supportare almeno create, start, stop, delete e cleanup usando strumenti nativi come `sc.exe`, PowerShell o equivalenti nativi di Windows;
7. usare NSSM solo come fallback quando il servizio non è gestibile correttamente con strumenti nativi, e in tal caso usare il binario locale in `\tools\nssm`;
8. se viene usato NSSM, gli script devono gestire installazione, stop e rimozione completa dei servizi creati con NSSM;
9. nessun test deve lasciare sul PC servizi installati, anche se il test fallisce parzialmente;
10. i nomi dei servizi, i path di installazione e le chiavi di registro usate dai test devono essere prevedibili e documentate;
11. upgrade e uninstall devono essere verificabili tramite script, non solo manualmente.

### Requisiti minimi degli script MSI
Gli script o template MSI devono coprire almeno:
- build dell’installer;
- installazione silenziosa per test;
- upgrade da versione precedente compatibile;
- uninstall silenziosa;
- cleanup finale di file residui e servizi.

Se il repository non fornisce già una toolchain MSI equivalente, gli script devono saper usare `\tools\wix314-binaries` senza dipendere da installazioni globali non documentate.

### Requisiti minimi degli script di servizio Windows
Gli script di gestione servizi devono coprire almeno:
- installazione servizio con strumenti nativi Windows;
- avvio e stop del servizio;
- disinstallazione del servizio;
- cleanup residui post-test;
- fallback opzionale a NSSM tramite `\tools\nssm`.

### Vincoli operativi
- non lasciare installazioni di test attive sulla macchina;
- non lasciare servizi Windows o NSSM attivi dopo i test;
- non lasciare directory temporanee o dati locali di test se non espressamente richiesti;
- centralizzare eventuali log di installazione e uninstall in `artifacts/logs`.

---

## Build, test, pack, publish, clean

Se il progetto li prevede, devono esistere meccanismi coerenti con lo stack adottato, ma l’interfaccia logica deve restare canonica.

### Regole
1. ogni comando deve essere ripetibile e documentato;
2. gli output devono finire in directory chiare e coerenti;
3. compile, build, test, pack e publish non vanno confusi tra loro;
4. `clean` deve riportare il repository a uno stato sorgente-only compatibile con i file versionati;
5. README, CI e `.gitignore` devono essere coerenti con questi flussi;
6. gli stessi flussi devono poter essere eseguiti localmente e in CI tramite gli stessi entrypoint;
7. `publish` deve operare su artefatti già prodotti da `pack`, salvo eccezioni documentate;
8. dopo ogni modifica a script operativi, gli script coinvolti devono essere testati realmente;
9. quando esiste un’app avviabile, il flusso di test deve includere almeno un test di avvio dell’app dopo un `clean`.

Percorsi tipici da coprire nel `clean`, se pertinenti:

```text
artifacts/
bin/
obj/
dist/
out/
target/
publish/
tmp/
```

---

## Verifica obbligatoria degli script

Quando vengono creati o aggiornati script di build, test, pack, publish, clean, MSI o gestione servizi, l’agente deve testare i flussi reali.

Sequenza minima obbligatoria, se pertinente:
1. eseguire `clean`;
2. eseguire `bootstrap` e `doctor` se richiesti dallo stack;
3. eseguire gli script aggiornati o generati;
4. eseguire `build` e `test`;
5. eseguire almeno uno smoke test di avvio app se l’app è eseguibile localmente;
6. se esiste packaging MSI, testare build MSI, installazione, upgrade compatibile e uninstall, usando in priorità la toolchain già presente nel repository o `\tools\wix314-binaries` quando è il tool locale previsto;
7. se esistono servizi Windows, testare installazione e disinstallazione tramite script nativi; usare il fallback NSSM solo se necessario tramite `\tools\nssm`;
8. verificare che non restino servizi Windows o NSSM installati;
9. verificare che non restino file residui non previsti;
10. rieseguire `clean` al termine dei test;
11. lasciare il repository pulito e senza installazioni locali di test.

Se un passaggio non è eseguibile nel contesto corrente, va dichiarato esplicitamente e non va simulato come eseguito.

---

## Modalità operative

### Light Mode
Usare per modifiche locali o mirate.

Minimo richiesto:
- verificare l’area modificata;
- correggere drift locale evidente;
- aggiornare documentazione minima se necessario.

### Full Sync Mode
Usare per:
- refactor;
- riorganizzazione repository;
- riallineamento documentazione;
- normalizzazione di struttura, script, build, test, pack, publish, clean, LICENSE o `.gitignore`.

Minimo richiesto:
- verificare gli entrypoint canonici;
- verificare la root `artifacts`;
- riallineare script, documentazione e stato;
- aggiornare `PROJECT_STATUS.json` se cambiano i flussi reali.

---

## Procedura finale

Per ogni modifica, se pertinente, verificare:
1. coerenza tra codice, script e documentazione;
2. presenza e coerenza di `README.md`;
3. presenza e coerenza di `.gitignore`;
4. correttezza di bootstrap, doctor, compile, build, test, pack, publish e clean;
5. separazione corretta tra sorgente, test, script, documentazione, configurazione e output;
6. allineamento di `PROJECT_STATUS.json` con gli entrypoint reali;
7. corretto confinamento degli output sotto `artifacts/`;
8. se presenti flussi Windows, correttezza di script MSI, upgrade, uninstall, gestione servizi nativa e fallback NSSM;
9. uso coerente di `\tools\wix314-binaries` per MSI quando non esiste già un’altra toolchain dichiarata, e di `\tools\nssm` solo come fallback;
10. esecuzione di un clean finale dopo i test;
11. assenza finale di servizi Windows o NSSM lasciati installati dal ciclo di test.

Obiettivo: lasciare il repository in uno stato pulito, coerente, standardizzato, scalabile e deterministico.
