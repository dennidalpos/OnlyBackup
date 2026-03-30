# AGENTS.md

## Scopo

Definire uno standard operativo riusabile per repository di natura diversa, utile come base comune per nuovi progetti e come riferimento per riallineare repository esistenti.

Questo file non impone un unico modello organizzativo valido per tutti i casi.
Stabilisce invece:
- principi sempre validi;
- convenzioni consigliate;
- regole da applicare solo quando pertinenti;
- criteri per adattarsi allo stack e allo stato reale del repository.

Obiettivo: aiutare l'agente a lasciare il repository in uno stato più chiaro, coerente, verificabile e mantenibile, senza introdurre struttura, documentazione o processi inutili.

---

## Modello di applicazione

Questo standard si applica a livelli.

### Livello 1 — principi sempre validi
Regole trasversali applicabili a qualsiasi repository.

### Livello 2 — convenzioni consigliate
Pattern utili nella maggior parte dei repository, da applicare solo se migliorano davvero il progetto.

### Livello 3 — regole condizionali
Valide solo quando il repository presenta realmente il caso, ad esempio:
- monorepo;
- packaging o publish;
- servizi o processi installabili;
- tooling locale;
- componenti distribuibili;
- layout multi-app o multi-package.

### Livello 4 — regole specifiche di progetto
Devono emergere dal repository reale, dalle sue convenzioni, dalla documentazione esistente e dagli eseguibili già presenti.
Non vanno inventate in assenza di evidenza concreta.

---

## Principi non negoziabili

1. Lo stato reale del repository viene prima delle assunzioni.
2. A parità di input e stato, i comandi dovrebbero produrre risultati coerenti e ripetibili.
3. I cambiamenti devono essere minimi rispetto al perimetro richiesto, ma completi nell'area toccata.
4. In caso di dubbio si preferiscono modifiche sicure, verificabili e conservative.
5. Non introdurre dipendenze da stato locale implicito se non dichiarato.
6. Non inventare requisiti, file, flussi o convenzioni non supportati dal repository.
7. La documentazione e la configurazione devono restare coerenti con il comportamento reale.
8. I file generati devono avere destinazioni prevedibili e non contaminare sorgenti o configurazioni.
9. Legacy, dead code e duplicazioni non dovrebbero essere mantenuti senza motivo verificabile.
10. Non dichiarare come eseguito ciò che non è stato realmente verificato.
11. Le convenzioni native dello stack vanno rispettate prima di imporre una standardizzazione esterna.
12. Ogni riallineamento strutturale deve avere un beneficio concreto in chiarezza, manutenzione o verificabilità.

---

## Priorità di verità

In caso di conflitto, l'ordine di priorità è:

1. repository reale;
2. codice, test, script e configurazioni eseguibili;
3. specifiche o documenti tecnici strutturali del progetto, se esistono;
4. stato operativo o tracking locale del repository, se esiste;
5. documentazione introduttiva.

Il drift non va ignorato:
- correggerlo subito se la correzione è chiara, sicura e limitata;
- altrimenti registrarlo nel meccanismo di tracking già usato dal repository;
- se non esiste un meccanismo di tracking chiaro, proporne uno minimo e coerente invece di introdurre sistemi ridondanti.

---

## Politica di modifica

L'agente deve:
1. osservare prima lo stato reale del repository;
2. derivare la soluzione minima coerente con quello stato;
3. preservare stack, convenzioni e layout già consolidati, salvo forte evidenza contraria;
4. evitare refactor non necessari al task o al riallineamento locale evidente;
5. mantenere allineati, per quanto toccati, codice, test, script, documentazione e configurazione;
6. non introdurre file o directory standard inutili;
7. non lasciare artefatti temporanei o output generati come stato persistente, salvo scelta esplicita del progetto;
8. centralizzare logiche e configurazioni riusabili quando il riuso è reale e il dominio resta chiaro;
9. evitare contenitori generici che accumulano responsabilità eterogenee;
10. rimuovere codice legacy o morto quando la rimozione è verificabile e a basso rischio;
11. tracciare in modo esplicito ciò che non è prudente completare nel turno corrente.

Regola guida: adattarsi prima al repository, proporre convergenze dopo.

---

## Convenzioni sui file di governo

Alcuni file sono spesso utili nella root, ma non sono tutti obbligatori in ogni repository.

Esempi comuni:

```text
AGENTS.md
README.md
.gitignore
LICENSE
PROJECT_SPEC.md
PROJECT_STATUS.json
```

### Regole
- `README.md` è normalmente il punto di ingresso per utenti e contributor.
- `AGENTS.md` definisce il comportamento operativo dell'agente, se il progetto lo usa.
- `PROJECT_SPEC.md` è utile quando serve una specifica tecnica strutturale stabile.
- `PROJECT_STATUS.json` o equivalente è utile quando il repository usa tracking operativo locale.
- `LICENSE` va mantenuto solo quando il repository richiede una policy di licenza esplicita.
- Non creare file di governo solo per aderire formalmente a uno standard, se non portano utilità concreta.
- Se il repository usa già file o convenzioni equivalenti, vanno preferiti quelli esistenti.

---

## Documentazione

La documentazione dovrebbe essere minima, chiara e non duplicata.

### Regole
- Non introdurre nuova documentazione senza uno scopo chiaro.
- Non duplicare contenuto già presente in codice, test, script o documenti esistenti.
- Rispettare la convenzione documentale già presente nel repository, ad esempio `README`, `docs/`, ADR, runbook o guide operative.
- La documentazione introduttiva deve restare breve e orientata all'uso.
- La documentazione tecnica strutturale, quando esiste, deve restare separata da tracking operativo e cronologia di lavoro.
- Il tracking operativo non dovrebbe trasformarsi in diario narrativo.

In generale: minimizzare la documentazione, non proibirla.

---

## Tracking operativo

Se il repository usa un file o documento di stato operativo, l'agente dovrebbe leggerlo e mantenerlo coerente.
Se non esiste, non va introdotto automaticamente salvo reale necessità.

Un tracking operativo locale è utile soprattutto quando serve registrare:
- stato sintetico del repository;
- target state;
- entrypoint rilevanti;
- task aperti;
- drift rilevati;
- blocchi o dipendenze esterne.

### Regole
- usare il meccanismo di tracking già adottato dal progetto, se presente;
- evitare inventari manuali fragili o ridondanti;
- registrare solo informazioni utili e mantenibili;
- chiudere o rimuovere i task superati;
- distinguere problemi reali da aspirazioni generiche non pianificate.

---

## Interfaccia operativa

Molti repository beneficiano di entrypoint stabili e pochi comandi canonici. Non esiste però un set obbligatorio universale.

Esempi frequenti:

```text
bootstrap
start
remove
doctor
compile
build
test
pack
publish
clean
```

### Regole
1. Gli entrypoint devono essere pochi, stabili e non ambigui.
2. README, CI e automazioni dovrebbero riferirsi agli stessi entrypoint logici quando applicabili.
3. Se il repository ha già comandi nativi chiari dello stack, non serve introdurre wrapper aggiuntivi.
4. Se esistono wrapper canonici, questi diventano la fonte di verità operativa.
5. Un comando non pertinente non va simulato.
6. Il naming può seguire lo stack del progetto, purché il flusso resti chiaro.

### Scelta degli script in base all'ambiente
- Scegliere il linguaggio o il runner degli script in base all'ambiente di sviluppo reale del repository.
- Su Windows, per l'automazione di processi locali, installazione, diagnostica, build helper e orchestrazione, preferire PowerShell salvo forte convenzione contraria del progetto.
- Su ambienti Unix-like, preferire shell script o gli strumenti nativi già adottati dal repository.
- In contesti multipiattaforma, preferire entrypoint coerenti e wrapper chiari invece di duplicare flussi senza necessità.
- Non introdurre PowerShell, bash o altri runner solo per preferenza personale quando il repository usa già un meccanismo stabile e diffuso.

---

## Separazione degli script

Quando il repository contiene più script, è consigliata una separazione per destinatario e responsabilità.

Struttura possibile:

```text
/scripts
  /user
  /dev
```

### Regole
- gli script rivolti agli utenti o operatori dovrebbero essere distinguibili da quelli tecnici interni;
- gli script tecnici non dovrebbero appesantire la documentazione introduttiva;
- se la separazione manca ma il repository è già piccolo e chiaro, non va forzata;
- se gli script sono mescolati e la separazione porterebbe beneficio concreto, il riallineamento può essere eseguito o pianificato.


## Riallineamento degli script

Quando il task riguarda il consolidamento o la pulizia degli script, l'agente deve trattare gli script come interfaccia operativa del repository e non come raccolta indistinta di utility.

### Obiettivi
- riorganizzare gli script per responsabilità reali;
- fare in modo che ogni script abbia uno scopo preciso e riconoscibile;
- rimuovere logiche ridondanti o duplicate;
- rendere evidente quando e come avviare ogni script;
- verificare con esecuzioni reali gli script toccati.

### Regole
1. prima di modificare gli script, censire quelli esistenti, il loro scopo, i loro input, gli output e le eventuali dipendenze reciproche;
2. classificare gli script per responsabilità e non per convenienza temporanea, ad esempio bootstrap, diagnostica, build, test, run, manutenzione o tooling interno;
3. evitare script monolitici con responsabilità miste quando la separazione porta chiarezza concreta;
4. ogni script deve avere una responsabilità primaria esplicita; orchestrazione e logiche condivise vanno separate quando il riuso è reale;
5. rimuovere wrapper inutili, alias opachi e passaggi duplicati che non aggiungono chiarezza o compatibilità;
6. centralizzare solo la logica veramente condivisa, evitando di creare moduli generici senza dominio chiaro;
7. se più script fanno varianti dello stesso flusso, consolidarli oppure chiarire in modo netto i casi d'uso distinti;
8. naming, posizione e parametri degli script devono riflettere il loro scopo operativo reale;
9. se il repository contiene script legacy o non più referenziati, verificarne l'effettiva inutilità prima di rimuoverli;
10. dopo il riallineamento, README, CI e documentazione operativa devono puntare agli entrypoint corretti.

### Documentazione degli script
Quando il repository contiene una directory `/scripts`, è consigliato mantenere un documento `/scripts/Script.md` che descriva in modo operativo gli script effettivamente supportati.

Il documento dovrebbe includere, se pertinenti:
- nome dello script;
- responsabilità principale;
- quando usarlo;
- prerequisiti o dipendenze;
- comandi di avvio;
- parametri rilevanti;
- output attesi o effetti collaterali;
- relazioni con altri script, se esistono.

### Vincoli
- `/scripts/Script.md` non deve duplicare integralmente il README, ma spiegare gli script in modo pratico e orientato ai casi d'uso;
- la documentazione deve riflettere solo script realmente presenti e verificati;
- se uno script non è più supportato, va rimosso dalla documentazione o marcato in modo esplicito;
- se il repository non contiene `/scripts`, non va creata documentazione artificiale solo per aderire formalmente a questa convenzione.

### Verifica
Nel caso di interventi sugli script, l'agente dovrebbe:
1. eseguire tutti gli script modificati o dichiarati come supportati, compatibilmente con il contesto corrente;
2. correggere errori rilevati durante l'esecuzione, quando la correzione è chiara e sicura;
3. registrare in modo esplicito gli script non eseguibili nel contesto corrente e il motivo;
4. non dichiarare come funzionanti script che non sono stati realmente testati;
5. lasciare il repository con una mappa degli script più semplice, non più ambigua.

---

## Layout del repository

Ogni repository dovrebbe avere una struttura leggibile e coerente con il proprio stack.
Non esiste un unico layout corretto per tutti i casi.

Un layout di riferimento comune può includere:

```text
/
├── AGENTS.md
├── README.md
├── .gitignore
├── LICENSE
├── /src
├── /tests
├── /scripts
├── /config
├── /tools
├── /artifacts
└── /tmp
```

### Regole
1. Preferire prima le convenzioni sane e native dello stack.
2. Usare directory separate per sorgenti, test, script, configurazioni e output quando la separazione è chiara e utile.
3. Evitare output generati dentro sorgenti, test o configurazioni, salvo convenzioni inevitabili dello stack.
4. Evitare crescita disordinata nella root.
5. Spostare file fuori posto solo quando il beneficio è chiaro e il rischio è basso.
6. Se il layout esistente è coerente, non forzare migrazioni strutturali solo per aderire a uno standard astratto.

---

## Domini e sottodomini

Quando il progetto cresce, il codice dovrebbe essere organizzato per responsabilità chiare.

### Regole
1. Ogni file dovrebbe avere un dominio o una responsabilità riconoscibile.
2. File troppo grandi o con responsabilità miste dovrebbero essere spezzati o almeno segnalati.
3. Moduli come `utils`, `helpers`, `common` o simili non dovrebbero diventare contenitori indistinti.
4. Le parti condivise vanno centralizzate solo quando il riuso è reale.
5. Se la gerarchia dei domini è insufficiente ma il refactor non è prudente nel turno corrente, il problema va tracciato.

---

## Output generati e artifact

Se il repository produce output persistenti, è consigliabile collocarli in percorsi prevedibili e separati dai sorgenti.

Una tassonomia frequente è:

```text
/artifacts
  /build
  /test-results
  /packages
  /publish
  /logs
```

### Regole
- usare directory dedicate per output persistenti quando controllabili dal repository;
- distinguere output temporanei da artifact utili;
- mantenere coerenti output reali, `.gitignore`, script di clean e documentazione;
- se lo stack genera output in posizioni fisse diverse, documentare l'eccezione solo se serve davvero.

---

## Repository singolo e monorepo

### Repository singolo
Le convenzioni si applicano direttamente alla root e alle directory operative principali.

### Monorepo
Per un monorepo può essere utile una convenzione top-level come:

```text
/apps
/packages
/scripts
/config
/artifacts
```

### Regole
- usare naming top-level coerente e non concorrente;
- distinguere elementi eseguibili da componenti riusabili quando il modello del repo lo richiede;
- evitare di imporre strutture da monorepo a repository semplici;
- applicare le stesse regole in piccolo alle unità interne, solo se compatibile con lo stack.

---

## Drift, legacy e dead code

Per drift si intende qualsiasi incoerenza rilevante tra:
- codice;
- configurazione;
- script;
- documentazione;
- tracking operativo;
- output attesi;
- struttura delle cartelle;
- target state dichiarato.

### Regole
1. correggere subito il drift quando la correzione è chiara, sicura e limitata;
2. altrimenti registrarlo nel sistema di tracking pertinente;
3. aggiornare in modo coerente i file coinvolti nell'area toccata;
4. rimuovere legacy, dead code e duplicazioni quando la rimozione è verificabile e coerente col ciclo di rilascio del repository;
5. se la rimozione completa non è prudente nel turno corrente, tracciare il residuo in modo esplicito.

Il repository non va trattato come stratificazione storica da preservare per default, ma non va neppure ripulito in modo aggressivo senza verifica sufficiente.

---

## `.gitignore`

L'agente dovrebbe verificare che `.gitignore` sia coerente con lo stack e con gli output reali del repository.

### Regole
1. se manca ed è necessario, crearlo;
2. se esiste, aggiornarlo in coerenza con gli artifact reali;
3. escludere output generati, cache locali e file temporanei non destinati al versionamento;
4. mantenere coerenza tra `.gitignore`, script di clean, output generati e convenzioni del repo.

Esempi frequenti, se pertinenti:

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

## `LICENSE`

L'agente deve verificare `LICENSE` solo quando il repository richiede una policy di licenza esplicita.

### Regole
- non imporre autore, anno o tipo di licenza hardcoded;
- non introdurre placeholder nel file finale;
- mantenere coerenti eventuali riferimenti presenti nel `README` o in altri documenti del progetto.

---

## Regole condizionali

Questa sezione si applica solo quando il repository tratta casi specifici, come:
- packaging e publish;
- servizi installabili;
- tooling locale complesso;
- installazione e uninstall;
- ambienti OS-specific;
- processi di deploy.

### Regole generali
1. usare prima gli strumenti già presenti nel repository;
2. introdurre tool nuovi solo se necessari e giustificati;
3. rendere verificabili i flussi critici come build, test, installazione, release o cleanup;
4. evitare che i test lascino stato persistente non previsto;
5. distinguere sempre tra convenzioni generiche e requisiti specifici del progetto.

---

## Modalità operative

### Bootstrap di un repository nuovo
Obiettivo:
- creare la struttura minima utile;
- definire pochi entrypoint chiari se necessari;
- impostare solo i file di governo realmente utili;
- evitare over-engineering iniziale.

### Allineamento di un repository esistente
Obiettivo:
- confrontare il repository con i principi di questo standard;
- correggere il drift chiaro e limitato;
- rispettare le convenzioni native del progetto;
- pianificare solo i riallineamenti che portano un beneficio reale.

### Intervento locale
Usare per modifiche mirate.
Minimo richiesto:
- verificare l'area toccata;
- correggere drift locale evidente;
- aggiornare gli elementi di stato o documentazione solo se necessario.

### Riallineamento strutturale
Usare per refactor organizzativi, consolidamento di script, pulizia legacy o razionalizzazione del layout.
Minimo richiesto:
- verificare i flussi rilevanti;
- riallineare i file toccati;
- rendere espliciti i task residui e i limiti non risolti.

---

## Verifica minima

Quando vengono creati o aggiornati script, configurazioni operative o flussi critici, l'agente dovrebbe testare ciò che è eseguibile nel contesto corrente.

Sequenza tipica, se pertinente:
1. eseguire il clean iniziale;
2. eseguire bootstrap o doctor se previsti;
3. eseguire i comandi aggiornati;
4. eseguire build e test;
5. eseguire uno smoke test quando il progetto è avviabile localmente;
6. rieseguire il clean finale se richiesto dal flusso;
7. lasciare il repository in uno stato coerente.

Se un passaggio non è eseguibile nel contesto corrente, va dichiarato esplicitamente e non simulato.

---

## Checklist finale

Per ogni modifica, se pertinente, verificare:
1. coerenza tra comportamento reale e file toccati;
2. assenza di requisiti inventati;
3. perimetro della modifica contenuto ma completo;
4. coerenza tra script, configurazione, output e `.gitignore`;
5. se il task tocca gli script, classificazione per responsabilità chiara e documentazione aggiornata in `/scripts/Script.md` quando pertinente;
6. assenza di drift locale evidente non dichiarato;
7. assenza di artifact temporanei lasciati senza motivo;
8. tracciamento esplicito dei residui non risolti;
9. stato finale più chiaro, mantenibile e prevedibile rispetto a quello iniziale.

Obiettivo: migliorare il repository senza irrigidirlo artificialmente.
