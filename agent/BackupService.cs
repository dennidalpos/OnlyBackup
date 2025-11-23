using System;
using System.Configuration;
using System.IO;
using System.Linq;
using System.ServiceProcess;
using System.Timers;

namespace BackupAgentService
{
    public class BackupService : ServiceBase
    {
        private WebSocketClient _client;
        private JobScheduler _scheduler;
        private Timer _heartbeatTimer;
        private string _logDir;
        private const long MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
        private const int MAX_LOG_FILES = 5;

        public BackupService()
        {
            ServiceName = "BackupAgentService";
        }

        protected override void OnStart(string[] args)
        {
            Init();
        }

        public void DebugRun()
        {
            Init();
        }

        private void Init()
        {
            try
            {
                _logDir = ConfigurationManager.AppSettings["LogDirectory"];
                if (string.IsNullOrWhiteSpace(_logDir))
                    _logDir = @"C:\ProgramData\BackupAgent\Logs";
                Directory.CreateDirectory(_logDir);
            }
            catch
            {
                _logDir = @"C:\ProgramData\BackupAgent\Logs";
                try
                {
                    Directory.CreateDirectory(_logDir);
                }
                catch
                {
                }
            }

            Log("Service starting");

            string serverUrl = null;
            try
            {
                serverUrl = ConfigurationManager.AppSettings["ServerUrl"];
            }
            catch
            {
                serverUrl = null;
            }

            if (string.IsNullOrWhiteSpace(serverUrl))
                serverUrl = "ws://localhost:8081";

            int heartbeatSeconds = 30;
            try
            {
                string hb = ConfigurationManager.AppSettings["HeartbeatSeconds"];
                int tmp;
                if (int.TryParse(hb, out tmp) && tmp > 0)
                    heartbeatSeconds = tmp;
            }
            catch
            {
            }

            try
            {
                _scheduler = new JobScheduler(Log, SendJobResult);
            }
            catch (Exception ex)
            {
                Log("Error creating JobScheduler: " + ex);
                _scheduler = null;
            }

            try
            {
                _client = new WebSocketClient(serverUrl, _scheduler, Log);
                _client.Connect();
            }
            catch (Exception ex)
            {
                Log("Error creating WebSocketClient: " + ex);
                _client = null;
            }

            try
            {
                _heartbeatTimer = new Timer(heartbeatSeconds * 1000);
                _heartbeatTimer.Elapsed += (s, e) =>
                {
                    try
                    {
                        if (_client != null)
                            _client.SendHeartbeat();
                    }
                    catch (Exception exTimer)
                    {
                        Log("Error in heartbeat: " + exTimer);
                    }
                };
                _heartbeatTimer.Start();
            }
            catch (Exception ex)
            {
                Log("Error starting heartbeat timer: " + ex);
                if (_heartbeatTimer != null)
                {
                    try
                    {
                        _heartbeatTimer.Stop();
                        _heartbeatTimer.Dispose();
                    }
                    catch
                    {
                    }
                    _heartbeatTimer = null;
                }
            }

            Log("Service started");
        }

        protected override void OnStop()
        {
            Log("Service stopping");
            try
            {
                if (_heartbeatTimer != null)
                {
                    _heartbeatTimer.Stop();
                    _heartbeatTimer.Dispose();
                    _heartbeatTimer = null;
                }
            }
            catch
            {
            }

            try
            {
                if (_client != null)
                {
                    _client.Dispose();
                    _client = null;
                }
            }
            catch
            {
            }

            Log("Service stopped");
        }

        private void Log(string message)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_logDir))
                    _logDir = @"C:\ProgramData\BackupAgent\Logs";
                Directory.CreateDirectory(_logDir);
                
                string file = Path.Combine(_logDir, "agent.log");
                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message;
                
                RotateLogIfNeeded(file);
                
                File.AppendAllLines(file, new[] { line });
            }
            catch
            {
            }
        }

        private void RotateLogIfNeeded(string logFile)
        {
            try
            {
                if (!File.Exists(logFile))
                    return;

                var fileInfo = new FileInfo(logFile);
                if (fileInfo.Length < MAX_LOG_SIZE_BYTES)
                    return;

                string logDir = Path.GetDirectoryName(logFile);
                string baseName = Path.GetFileNameWithoutExtension(logFile);
                string extension = Path.GetExtension(logFile);

                var existingLogs = Directory.GetFiles(logDir, baseName + "*" + extension)
                    .Where(f => f != logFile)
                    .OrderByDescending(f => f)
                    .ToList();

                foreach (var oldLog in existingLogs.Skip(MAX_LOG_FILES - 2))
                {
                    try
                    {
                        File.Delete(oldLog);
                    }
                    catch
                    {
                    }
                }

                for (int i = existingLogs.Count - 1; i >= 0; i--)
                {
                    string oldFile = existingLogs[i];
                    string oldNum = Path.GetFileNameWithoutExtension(oldFile).Replace(baseName + ".", "");
                    int num;
                    if (int.TryParse(oldNum, out num))
                    {
                        string newFile = Path.Combine(logDir, baseName + "." + (num + 1) + extension);
                        try
                        {
                            if (File.Exists(newFile))
                                File.Delete(newFile);
                            File.Move(oldFile, newFile);
                        }
                        catch
                        {
                        }
                    }
                }

                string rotatedFile = Path.Combine(logDir, baseName + ".1" + extension);
                try
                {
                    if (File.Exists(rotatedFile))
                        File.Delete(rotatedFile);
                    File.Move(logFile, rotatedFile);
                }
                catch
                {
                }
            }
            catch
            {
            }
        }

        private void SendJobResult(JobResult result)
        {
            try
            {
                if (_client != null)
                    _client.SendJobResult(result);
            }
            catch (Exception ex)
            {
                Log("Error sending job result: " + ex);
            }
        }
    }
}