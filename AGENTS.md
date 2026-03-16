
# AGENTS.md

## Principi non negoziabili

1. Il repository deve rimanere coerente tra codice, documentazione e stato del progetto.
2. Nessuna modifica deve lasciare codice, documentazione o stato fuori sincronizzazione senza una motivazione esplicita.
3. Se viene individuato drift tra codice, documentazione e stato del progetto deve essere:
   - corretto immediatamente se la correzione è sicura;
   - oppure tracciato come task in `PROJECT_STATUS.json`.
4. L’agente non deve inventare requisiti non supportati dal repository.
5. In caso di dubbio l’agente deve preferire la soluzione conservativa: tracciare il problema invece di modificare codice in modo speculativo.

---

# File standard del repository

Il repository deve contenere nella root:

```
AGENTS.md
PROJECT_SPEC.md
PROJECT_STATUS.json
README.md
```

Questi file costituiscono l’interfaccia tra repository e agenti.

Se uno di questi file manca deve essere creato in forma minima.

---

# Documenti

## PROJECT_SPEC.md

Contiene:

- obiettivi
- architettura
- comportamento atteso
- vincoli

Non contiene task.

## PROJECT_STATUS.json

Contiene esclusivamente:

- struttura repository
- file grandi monitorati
- task attivi

Schema minimo:

```json
{
  "treeview": [],
  "files_big": [],
  "tasks": []
}
```

## README.md

Documento orientato agli utenti del repository:

- descrizione
- setup
- run
- link alla documentazione

---

# Gerarchia di verità

In caso di conflitto tra fonti:

1. Repository reale
2. Test e configurazioni eseguibili
3. `PROJECT_SPEC.md`
4. `PROJECT_STATUS.json`
5. `README.md`

Il repository reale ha priorità sulla documentazione, ma il drift deve essere sempre corretto o tracciato.

---

# Gestione drift

Drift = incoerenza tra:

- codice
- documentazione
- stato del progetto

Quando viene rilevato drift:

1. correggere se la soluzione è chiara e sicura
2. altrimenti creare task
3. aggiornare documentazione e stato

Il drift non deve essere ignorato.

---

# Struttura repository

Struttura consigliata:

```
/docs
/scripts
/src
/tests
/tools
```

Regole:

- file e cartelle devono stare nella posizione corretta
- script e documentazione non devono rimanere sparsi nella root
- se file risultano in posizioni incoerenti devono essere spostati e riferimenti aggiornati
- se il progetto usa una struttura diversa già definita, deve essere rispettata

---

# Struttura cartelle di build / publish

Tutte le cartelle generate da build, publish o compilazione devono avere una struttura **coerente e riconoscibile partendo dalla root**.

Regole:

- la struttura delle cartelle di output deve essere uguale per tutte le build del repository
- la cartella deve essere identificabile immediatamente come output di build
- se esistono già cartelle di output con strutture diverse devono essere normalizzate
- dopo la normalizzazione devono essere aggiornati:
  - documentazione
  - script
  - riferimenti nel repository

---

# Modalità di lavoro

## Full Sync Mode

Usare quando:

- refactor
- modifiche architetturali
- riorganizzazione repository
- riallineamento documentazione

Operazioni:

- aggiornamento `treeview`
- controllo file grandi
- verifica drift nelle aree interessate

## Light Mode

Usare per modifiche locali.

Operazioni:

- verifica area modificata
- controllo drift locale
- aggiornamento documentazione se necessario

---

# PROJECT_STATUS.json

## treeview

Lista dei file reali del repository (path relativi alla root).

Esempio:

```json
[
"README.md",
"PROJECT_SPEC.md",
"src/main.py"
]
```

## files_big

File ≥ 800 linee.

Formato:

```
"path/file.ext:1234"
```

File ≥1500 linee devono essere valutati per refactor.

## tasks

Schema minimo:

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

Regole:

- task completati rimossi
- priorità minore = più importante

---

# Selezione task

Ordine:

1. continuare task `in_progress`
2. altrimenti `pending` con priorità più alta

È possibile avere più task `in_progress` se fanno parte dello stesso intervento o se permette di chiudere più attività insieme.

---

# Chiusura task

Un task può essere rimosso quando:

- lavoro completato
- documentazione aggiornata
- repository coerente nell’area interessata

È possibile chiudere **più task nello stesso intervento** se il lavoro li risolve contemporaneamente.

---

# Aggiornamento PROJECT_STATUS.json

Deve essere aggiornato quando:

- cambia la struttura repository
- cambiano task
- compaiono file grandi
- viene corretto o tracciato drift

---

# Formato risposta finale

Ogni risposta finale deve includere:

## Changes

Modifiche effettuate.

## Alignment

- file aggiornati
- drift rilevati
- drift corretti
- nuovi task creati

## Repository Status

- task attivo
- task rimanenti

## Notes

Osservazioni.

---

# Regola finale

L’agente deve mantenere il repository sempre consistente, verificabile e documentato.
