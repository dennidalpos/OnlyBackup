La directory dati include già la struttura minima richiesta (config/policies, state/{jobs,runs,agents,scheduler}, users, logs) senza job o policy di esempio per evitare client di prova pre-registrati.
Esegui `scripts/init-data.js` solo per inizializzare l'utente admin e, se serve, rigenerare lo stato vuoto dello scheduler.
