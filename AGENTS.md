# AGENTS.md

## Scopo

Definire le regole operative minime per mantenere qualsiasi repository coerente, pulito, documentato e con una struttura standard riutilizzabile.

L’agente deve privilegiare modifiche:
- sicure;
- verificabili;
- coerenti con lo stato reale del repository;
- conservative in caso di dubbio.

---

## Priorità di verità

In caso di conflitto, l’ordine di priorità è:

1. repository reale;
2. test, script e configurazioni eseguibili;
3. `PROJECT_SPEC.md`;
4. `PROJECT_STATUS.json`;
5. `README.md`.

Il drift tra queste fonti non va ignorato:
- correggerlo subito se la soluzione è chiara, sicura e limitata;
- altrimenti tracciarlo in `PROJECT_STATUS.json`.

---

## Regole obbligatorie

1. Codice, configurazione, script, documentazione e stato del progetto devono restare coerenti.
2. Non inventare requisiti non supportati dal repository.
3. In caso di dubbio preferire la soluzione conservativa.
4. Rispettare stack, convenzioni e struttura già consolidati, salvo forte evidenza contraria.
5. Build, test, clean, publish, `.gitignore`, `README.md` e output generati devono restare allineati.
6. Non lasciare nel repository artefatti temporanei o di compilazione come stato persistente, salvo richiesta esplicita.
7. Mantenere separazione chiara tra sorgente, test, script, documentazione e output.
8. Non ampliare inutilmente il perimetro delle modifiche; correggere solo il drift evidente e sicuro nelle aree coinvolte.

---

## File di governo

Quando applicabili e necessari al corretto governo del repository, nella root devono esistere almeno:

```text
AGENTS.md
PROJECT_SPEC.md
PROJECT_STATUS.json
README.md
LICENSE
.gitignore
```

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
Contiene solo:
- struttura del repository;
- file grandi monitorati;
- task attivi.

Schema minimo:

```json
{
  "treeview": [],
  "files_big": [],
  "tasks": []
}
```

Regole:
- aggiornare `treeview` solo se la struttura del repository cambia in modo pertinente;
- elencare in `files_big` solo file reali non generati con almeno 800 linee;
- inserire in `tasks` solo problemi aperti, specifici e verificabili;
- rimuovere i task completati.

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
- build;
- run;
- test;
- publish o packaging;
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
- stato del progetto.

Quando il drift viene rilevato:
1. correggerlo subito se la correzione è chiara, sicura e limitata;
2. altrimenti creare un task in `PROJECT_STATUS.json`;
3. aggiornare i documenti coinvolti in modo minimo ma coerente.

Esempi:
- `LICENSE` mancante o incoerente;
- `.gitignore` mancante o incompleto;
- script di build, test, clean o publish non allineati;
- output generati in percorsi incoerenti;
- README non coerente con il comportamento reale del repository.

---

## Struttura standard del repository

Struttura di riferimento, da applicare solo quando compatibile con lo stack e con la convenzione già consolidata:

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
├── /tools
├── /assets
├── /examples
├── /config
├── /build
├── /dist
├── /publish
└── /tmp
```

Non tutte queste directory devono esistere sempre: creare solo quelle realmente giustificate.

### Regole di struttura
- `/src`: codice sorgente principale versionato.
- `/tests`: test automatizzati, fixture e dati di test.
- `/scripts`: entrypoint operativi di repository.
- `/docs`: documentazione tecnica o utente non adatta al README.
- `/tools`: utility di sviluppo o manutenzione non entrypoint.
- `/assets`: asset statici versionati.
- `/examples`: esempi minimi di utilizzo.
- `/config`: configurazioni condivise non già gestite chiaramente dallo stack.
- `/build`: output intermedi locali.
- `/dist`: artefatti distribuibili.
- `/publish`: output pronti alla pubblicazione o al deploy.
- `/tmp`: file temporanei locali, sempre ignorati da git.

### Convenzioni strutturali
1. Il sorgente sta in `/src`.
2. I test stanno in `/tests`.
3. Gli script standard stanno in `/scripts`.
4. La documentazione estesa sta in `/docs`.
5. Gli output generati stanno in `/build`, `/dist` o `/publish`.
6. Gli output non devono finire dentro `/src`, `/tests` o `/docs`.
7. La root deve restare pulita: solo file di governo, manifest principali, entrypoint top-level realmente necessari e directory standard di primo livello.

---

## Repo singolo e monorepo

### Repo singolo
La struttura standard si applica direttamente alla root.

### Monorepo
Usare una directory contenitore chiara, ad esempio una tra:

```text
/apps
/packages
/services
/libs
/projects
```

Non mischiare naming top-level senza motivo.

Ogni unità interna deve seguire lo stesso standard in piccolo:

```text
/apps/app-a/src
/apps/app-a/tests
/apps/app-a/README.md
```

Regole:
- usare `apps` o `services` per elementi eseguibili;
- usare `packages` o `libs` per componenti riusabili;
- scegliere un solo naming top-level coerente.

---

## LICENSE

L’agente deve verificare `LICENSE`.

Procedura:
1. rilevare il nome reale del progetto privilegiando repository, cartella root, `README.md` e file di configurazione;
2. verificare se `LICENSE` esiste;
3. se manca, crearla;
4. se esiste ma non è coerente con il repository, aggiornarla;
5. allineare eventuali riferimenti in `README.md`.

Vincoli:
- autore fisso: `Danny Perondi`;
- anno: anno corrente;
- nome progetto: nome reale rilevato;
- creare una licenza proprietaria minima solo se il repository non mostra già una licenza diversa chiaramente valida e supportata;
- nessun placeholder nel file finale.

Template minimo:

```text
Copyright (c) 2026 Danny Perondi

Project: <PROJECT_NAME>

All rights reserved.

This project and its source code are proprietary.
Unauthorized copying, modification, distribution, sublicensing,
or commercial use is prohibited without prior written permission.

This software is provided "AS IS", without warranty of any kind,
express or implied. In no event shall the author be liable for any claim,
damages or other liability arising from, out of, or in connection with the software
or the use or other dealings in the software.
```

---

## `.gitignore`

L’agente deve verificare `.gitignore`.

Regole:
1. se manca, crearlo;
2. se esiste, aggiornarlo in coerenza con lo stack reale;
3. escludere tutti gli artefatti generati che non devono essere versionati.

Percorsi tipici da ignorare, se pertinenti:

```text
bin/
obj/
build/
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

`.gitignore`, build, test report, clean e publish devono restare coerenti.

---

## Build, test, publish, clean

Se il progetto li prevede, devono esistere meccanismi coerenti con lo stack adottato, tramite:
- `scripts/*.`;
- `make`;
- comandi nativi dello stack;
- pipeline chiaramente richiamabili e documentate.

### Regole
1. ogni comando deve essere ripetibile e documentato;
2. gli output devono finire in directory chiare e coerenti;
3. build locale, packaging e publish non vanno confusi tra loro;
4. clean deve riportare il repository a uno stato sorgente-only compatibile con i file versionati;
5. clean non deve cancellare sorgenti, configurazioni o documentazione reali;
6. README e `.gitignore` devono essere coerenti con questi flussi.

Percorsi da coprire nel clean, se pertinenti:

```text
build/
dist/
out/
target/
bin/
obj/
publish/
tmp/
```

---

## Modalità operative

### Light Mode
Usare per modifiche locali.

Minimo richiesto:
- verificare l’area modificata;
- correggere drift locale evidente;
- aggiornare documentazione minima se necessario.

### Full Sync Mode
Usare per:
- refactor;
- riorganizzazione repository;
- riallineamento documentazione;
- normalizzazione di struttura, build, test, publish, clean, LICENSE o `.gitignore`.

Minimo richiesto:
- aggiornare `treeview` se la struttura cambia;
- controllare `files_big` se pertinente;
- verificare drift nelle aree coinvolte;
- riallineare script, documentazione e stato.

---

## Procedura finale

Per ogni modifica, se pertinente, verificare:
1. coerenza tra codice, script e documentazione;
2. presenza e coerenza di `LICENSE`;
3. presenza e coerenza di `.gitignore`;
4. correttezza di build, test, publish e clean;
5. separazione corretta tra sorgente, test, script, documentazione e output;
6. allineamento di `README.md` e `PROJECT_STATUS.json`.

Obiettivo: lasciare il repository in uno stato pulito, coerente, standardizzato e documentato.
