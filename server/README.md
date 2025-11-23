## Requisiti

- Node.js (versione LTS recente)
- Porta HTTP 8080
- Porta WebSocket 8081

## Installazione

```bash
cd server
npm install
node app.js

Dashboard: http://SERVER:8080/

Admin predefinito:

Utente: SuperBackup

Password: Password01!

Modificabile in config.json.

Per installare come servizio Windows (facoltativo):

cd server
npm install
node install-service.js


Parametri server (porte, credenziali admin, TLS) in config.json.
Dati persistenti (agent, job, history) in data/.


---

```xml
<!-- agent/App.config -->
<?xml version="1.0" encoding="utf-8" ?>
<configuration>
  <startup>
    <supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2" />
  </startup>
  <appSettings>
    <!-- URL WebSocket server (senza path) -->
    <add key="ServerUrl" value="ws://YOUR_SERVER_HOST:8081" />
    <!-- intervallo heartbeat (secondi) -->
    <add key="HeartbeatSeconds" value="30" />
    <!-- cartella log -->
    <add key="LogDirectory" value="C:\ProgramData\BackupAgent\Logs" />
  </appSettings>
</configuration>