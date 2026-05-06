using System;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text.RegularExpressions;

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
                throw new FileNotFoundException(BuildPrerequisiteMessage(
                    "entrypoint server OnlyBackup",
                    "server\\src\\server.js incluso nel package corrente",
                    "il servizio Windows deve avviare il server Node.js",
                    "ripara o rigenera il package OnlyBackup Server",
                    "Test-Path .\\server\\src\\server.js"), serverScript);
            }

            string repoRoot = Path.GetFullPath(Path.Combine(serverDirectory, ".."));
            string logsDir = Path.Combine(repoRoot, "logs");
            Directory.CreateDirectory(logsDir);
            ValidateServerPayload(serverDirectory, repoRoot);
            string resolvedNodePath = ResolveNodeExecutable(nodePath);
            AssertNodeVersion(resolvedNodePath);

            var startInfo = new ProcessStartInfo
            {
                FileName = resolvedNodePath,
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

        private static void ValidateServerPayload(string serverDirectory, string repoRoot)
        {
            string nodeModulesPath = Path.Combine(serverDirectory, "node_modules");
            if (!Directory.Exists(nodeModulesPath))
            {
                throw new DirectoryNotFoundException(BuildPrerequisiteMessage(
                    "dipendenze npm server",
                    "package-lock.json del package corrente",
                    "il servizio avvia il server senza eseguire npm ci al primo avvio",
                    "riesegui Install-OnlyBackupServer.ps1 dal package completo o rigenera il package con Setup-OnlyBackupServer.ps1 -BuildPackage",
                    "Test-Path .\\server\\node_modules"));
            }

            string configPath = ConfigurationManager.AppSettings["ConfigPath"];
            if (!String.IsNullOrWhiteSpace(configPath) && !File.Exists(configPath))
            {
                throw new FileNotFoundException(BuildPrerequisiteMessage(
                    "config.json",
                    "config.json incluso nel package corrente",
                    "il server deve leggere host, porta e dataRoot al primo avvio",
                    "ripristina config.json nel package installato o rilancia il setup da un package integro",
                    "Test-Path .\\config.json"), configPath);
            }

            string usersPath = Path.Combine(ResolveDataRoot(configPath, repoRoot), "users", "users.json");
            if (!File.Exists(usersPath))
            {
                throw new FileNotFoundException(BuildPrerequisiteMessage(
                    "dati iniziali OnlyBackup",
                    "data\\users\\users.json creato dal bootstrap",
                    "al primo avvio deve esistere l'utente admin iniziale",
                    "rilancia Install-OnlyBackupServer.ps1 passando -InitialAdminPassword oppure -InitialAdminPasswordFile",
                    "Test-Path .\\data\\users\\users.json"), usersPath);
            }
        }

        private static string ResolveDataRoot(string configPath, string repoRoot)
        {
            if (String.IsNullOrWhiteSpace(configPath) || !File.Exists(configPath))
            {
                return Path.Combine(repoRoot, "data");
            }

            string configText = File.ReadAllText(configPath);
            var match = Regex.Match(configText, @"""dataRoot""\s*:\s*""(?<value>(?:\\.|[^""\\])*)""");
            if (!match.Success)
            {
                return Path.Combine(Path.GetDirectoryName(configPath), "data");
            }

            string configuredDataRoot = Regex.Unescape(match.Groups["value"].Value);
            if (Path.IsPathRooted(configuredDataRoot))
            {
                return configuredDataRoot;
            }

            return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(configPath), configuredDataRoot));
        }

        private static string ResolveNodeExecutable(string nodePath)
        {
            if (File.Exists(nodePath))
            {
                return Path.GetFullPath(nodePath);
            }

            string pathVariable = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
            foreach (string directory in pathVariable.Split(Path.PathSeparator))
            {
                if (String.IsNullOrWhiteSpace(directory))
                {
                    continue;
                }

                string candidate = Path.Combine(directory.Trim(), nodePath);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            throw new FileNotFoundException(BuildPrerequisiteMessage(
                "Node.js",
                ">= 20.19.0",
                "il servizio Windows avvia il server OnlyBackup tramite Node.js",
                "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riavvia il servizio, oppure configura NodePath con il percorso completo di node.exe",
                "node --version"), nodePath);
        }

        private static void AssertNodeVersion(string nodePath)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "--version",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (var process = Process.Start(startInfo))
            {
                string output = process.StandardOutput.ReadToEnd().Trim();
                string error = process.StandardError.ReadToEnd().Trim();
                process.WaitForExit(10000);

                if (process.ExitCode != 0)
                {
                    throw new InvalidOperationException(BuildPrerequisiteMessage(
                        "Node.js",
                        ">= 20.19.0",
                        "il servizio Windows deve verificare la versione Node.js prima del primo avvio",
                        "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riavvia il servizio",
                        "node --version") + Environment.NewLine + error);
                }

                var match = Regex.Match(output, @"v?(\d+)\.(\d+)\.(\d+)");
                if (!match.Success)
                {
                    throw new InvalidOperationException("Prerequisito non verificabile: Node.js" + Environment.NewLine +
                        "Versione minima/supportata: >= 20.19.0" + Environment.NewLine +
                        "Versione trovata: " + output + Environment.NewLine +
                        "Verifica: node --version");
                }

                int major = Int32.Parse(match.Groups[1].Value);
                int minor = Int32.Parse(match.Groups[2].Value);
                int patch = Int32.Parse(match.Groups[3].Value);
                if (major < 20 || (major == 20 && (minor < 19 || (minor == 19 && patch < 0))))
                {
                    throw new InvalidOperationException("Prerequisito non compatibile: Node.js" + Environment.NewLine +
                        "Versione trovata: " + output + Environment.NewLine +
                        "Versione minima/supportata: >= 20.19.0" + Environment.NewLine +
                        "Motivo: il server OnlyBackup usa dipendenze npm che richiedono Node.js moderno." + Environment.NewLine +
                        "Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riavvia il servizio." + Environment.NewLine +
                        "Verifica: node --version");
                }
            }
        }

        private static string BuildPrerequisiteMessage(string name, string minimumVersion, string reason, string action, string verification)
        {
            return "Prerequisito mancante/non compatibile: " + name + Environment.NewLine +
                "Versione minima/supportata: " + minimumVersion + Environment.NewLine +
                "Motivo: " + reason + Environment.NewLine +
                "Azione richiesta: " + action + Environment.NewLine +
                "Verifica: " + verification;
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
