using System;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

namespace OnlyBackupServerService.Service
{
    public class NodeServerService : ServiceBase
    {
        private Process nodeProcess;

        public NodeServerService()
        {
            ServiceName = "OnlyBackupServer";
            CanStop = true;
            CanShutdown = true;
        }

        protected override void OnStart(string[] args)
        {
            StartNodeServer();
        }

        protected override void OnStop()
        {
            StopNodeServer();
        }

        protected override void OnShutdown()
        {
            StopNodeServer();
        }

        public void StartConsole()
        {
            StartNodeServer();
        }

        public void StopConsole()
        {
            StopNodeServer();
        }

        private void StartNodeServer()
        {
            string serverDirectory = RequireConfiguredPath("ServerDirectory");
            string nodePath = ConfigurationManager.AppSettings["NodePath"];
            if (String.IsNullOrWhiteSpace(nodePath))
            {
                nodePath = "node.exe";
            }

            string serverScript = Path.Combine(serverDirectory, "src", "server.js");
            if (!File.Exists(serverScript))
            {
                throw new FileNotFoundException("Entry server non trovato.", serverScript);
            }

            string repoRoot = Path.GetFullPath(Path.Combine(serverDirectory, ".."));
            string logsDir = Path.Combine(repoRoot, "logs");
            Directory.CreateDirectory(logsDir);

            var startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\"" + serverScript + "\"",
                WorkingDirectory = serverDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            string configPath = ConfigurationManager.AppSettings["ConfigPath"];
            if (!String.IsNullOrWhiteSpace(configPath))
            {
                startInfo.EnvironmentVariables["CONFIG_PATH"] = configPath;
            }

            nodeProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            nodeProcess.OutputDataReceived += (sender, eventArgs) => AppendLine(Path.Combine(logsDir, "server-stdout.log"), eventArgs.Data);
            nodeProcess.ErrorDataReceived += (sender, eventArgs) => AppendLine(Path.Combine(logsDir, "server-stderr.log"), eventArgs.Data);
            nodeProcess.Exited += (sender, eventArgs) => LogEvent("Processo Node.js terminato con exit code " + nodeProcess.ExitCode, EventLogEntryType.Warning);

            nodeProcess.Start();
            nodeProcess.BeginOutputReadLine();
            nodeProcess.BeginErrorReadLine();

            LogEvent("OnlyBackup Server avviato. PID Node.js: " + nodeProcess.Id);
        }

        private void StopNodeServer()
        {
            if (nodeProcess == null)
            {
                return;
            }

            try
            {
                if (!nodeProcess.HasExited)
                {
                    nodeProcess.CloseMainWindow();
                    if (!nodeProcess.WaitForExit(10000))
                    {
                        nodeProcess.Kill();
                        nodeProcess.WaitForExit(5000);
                    }
                }

                LogEvent("OnlyBackup Server arrestato.");
            }
            catch (Exception ex)
            {
                LogEvent("Errore arresto processo Node.js: " + ex.Message, EventLogEntryType.Error);
            }
            finally
            {
                nodeProcess.Dispose();
                nodeProcess = null;
            }
        }

        private static string RequireConfiguredPath(string key)
        {
            string value = ConfigurationManager.AppSettings[key];
            if (String.IsNullOrWhiteSpace(value))
            {
                throw new ConfigurationErrorsException("Configurazione mancante: " + key);
            }

            string fullPath = Path.GetFullPath(value);
            if (!Directory.Exists(fullPath))
            {
                throw new DirectoryNotFoundException("Directory non trovata: " + fullPath);
            }

            return fullPath;
        }

        private static void AppendLine(string path, string line)
        {
            if (line == null)
            {
                return;
            }

            File.AppendAllText(path, "[" + DateTime.Now.ToString("s") + "] " + line + Environment.NewLine);
        }

        private static void LogEvent(string message, EventLogEntryType type = EventLogEntryType.Information)
        {
            try
            {
                const string source = "OnlyBackupServer";
                if (!EventLog.SourceExists(source))
                {
                    EventLog.CreateEventSource(source, "Application");
                }

                EventLog.WriteEntry(source, message, type);
            }
            catch
            {
                Console.WriteLine(message);
            }
        }
    }
}
