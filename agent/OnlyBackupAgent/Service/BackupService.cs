using System;
using System.Configuration;
using System.ServiceProcess;
using OnlyBackupAgent.Communication;

namespace OnlyBackupAgent.Service
{
    public partial class BackupService : ServiceBase
    {
        private HttpServer httpServer;
        private ServerCommunication serverComm;
        private System.Timers.Timer heartbeatTimer;

        public BackupService()
        {
            ServiceName = "OnlyBackupAgent";
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                LogEvent("OnlyBackup Agent avvio...");

                int agentPort = int.Parse(ConfigurationManager.AppSettings["AgentPort"] ?? "8081");
                string serverHost = ConfigurationManager.AppSettings["ServerHost"] ?? "localhost";
                int serverPort = int.Parse(ConfigurationManager.AppSettings["ServerPort"] ?? "8080");
                int heartbeatInterval = int.Parse(ConfigurationManager.AppSettings["HeartbeatInterval"] ?? "60000");

                serverComm = new ServerCommunication(serverHost, serverPort);
                serverComm.SetAgentPort(agentPort);

                httpServer = new HttpServer(agentPort, serverComm);
                httpServer.Start();

                heartbeatTimer = new System.Timers.Timer(heartbeatInterval);
                heartbeatTimer.Elapsed += (sender, e) => SendHeartbeat();
                heartbeatTimer.Start();

                LogEvent(String.Format("OnlyBackup Agent avviato su porta {0}", agentPort));
            }
            catch (Exception ex)
            {
                LogEvent(String.Format("Errore avvio servizio: {0}", ex.Message), System.Diagnostics.EventLogEntryType.Error);
                throw;
            }
        }

        protected override void OnStop()
        {
            try
            {
                LogEvent("OnlyBackup Agent arresto...");

                if (heartbeatTimer != null)
                {
                    heartbeatTimer.Stop();
                    heartbeatTimer.Dispose();
                }

                if (httpServer != null)
                {
                    httpServer.Stop();
                }

                LogEvent("OnlyBackup Agent arrestato");
            }
            catch (Exception ex)
            {
                LogEvent(String.Format("Errore arresto servizio: {0}", ex.Message), System.Diagnostics.EventLogEntryType.Error);
            }
        }

        public void StartConsole()
        {
            OnStart(null);
        }

        public void StopConsole()
        {
            OnStop();
        }

        private void SendHeartbeat()
        {
            try
            {
                serverComm.SendHeartbeat(Environment.MachineName);
            }
            catch (Exception ex)
            {
                LogEvent(String.Format("Errore invio heartbeat: {0}", ex.Message), System.Diagnostics.EventLogEntryType.Warning);
            }
        }

        private void LogEvent(string message, System.Diagnostics.EventLogEntryType type = System.Diagnostics.EventLogEntryType.Information)
        {
            try
            {
                if (!System.Diagnostics.EventLog.SourceExists("OnlyBackupAgent"))
                {
                    System.Diagnostics.EventLog.CreateEventSource("OnlyBackupAgent", "Application");
                }

                System.Diagnostics.EventLog.WriteEntry("OnlyBackupAgent", message, type);
            }
            catch
            {
                Console.WriteLine(String.Format("[{0}] {1}", type, message));
            }
        }
    }
}
