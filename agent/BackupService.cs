using System;
using System.Collections.Concurrent;
using System.Configuration;
using System.IO;
using System.Linq;
using System.ServiceProcess;
using System.Threading;
using System.Timers;

namespace BackupAgentService
{
    public class BackupService : ServiceBase
    {
        private WebSocketClient _client;
        private JobScheduler _scheduler;
        private System.Timers.Timer _heartbeatTimer;
        private string _logDir;
        private const long MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
        private const int MAX_LOG_FILES = 5;
        private ConcurrentQueue<string> _logQueue;
        private Thread _logThread;
        private volatile bool _logThreadRunning;
        private long _currentLogSize;
        private DateTime _lastRotationCheck;

        public BackupService()
        {
            ServiceName = "BackupAgentService";
            _logQueue = new ConcurrentQueue<string>();
            _logThreadRunning = false;
            _currentLogSize = 0;
            _lastRotationCheck = DateTime.MinValue;
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

            StartLogThread();
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
                _heartbeatTimer = new System.Timers.Timer(heartbeatSeconds * 1000);
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
            StopLogThread();
        }

        private void StartLogThread()
        {
            try
            {
                _logThreadRunning = true;
                _logThread = new Thread(LogThreadWorker);
                _logThread.IsBackground = true;
                _logThread.Start();
            }
            catch
            {
            }
        }

        private void StopLogThread()
        {
            try
            {
                _logThreadRunning = false;
                if (_logThread != null && _logThread.IsAlive)
                {
                    _logThread.Join(5000);
                }
            }
            catch
            {
            }
        }

        private void LogThreadWorker()
        {
            while (_logThreadRunning || !_logQueue.IsEmpty)
            {
                try
                {
                    string line;
                    if (_logQueue.TryDequeue(out line))
                    {
                        if (string.IsNullOrWhiteSpace(_logDir))
                            _logDir = @"C:\ProgramData\BackupAgent\Logs";
                        Directory.CreateDirectory(_logDir);
                        
                        string file = Path.Combine(_logDir, "agent.log");
                        RotateLogIfNeeded(file);
                        File.AppendAllLines(file, new[] { line });
                    }
                    else
                    {
                        Thread.Sleep(100);
                    }
                }
                catch
                {
                }
            }
        }

        private void Log(string message)
        {
            try
            {
                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message;
                _logQueue.Enqueue(line);
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
                {
                    _currentLogSize = 0;
                    return;
                }

                var now = DateTime.Now;
                if ((now - _lastRotationCheck).TotalSeconds < 60)
                {
                    _currentLogSize += 100;
                    if (_currentLogSize < MAX_LOG_SIZE_BYTES)
                        return;
                }

                _lastRotationCheck = now;
                var fileInfo = new FileInfo(logFile);
                _currentLogSize = fileInfo.Length;
                
                if (_currentLogSize < MAX_LOG_SIZE_BYTES)
                    return;

                string logDir = Path.GetDirectoryName(logFile);
                string baseName = Path.GetFileNameWithoutExtension(logFile);
                string extension = Path.GetExtension(logFile);

                for (int i = MAX_LOG_FILES - 1; i >= 1; i--)
                {
                    string oldFile = Path.Combine(logDir, baseName + "." + i + extension);
                    string newFile = Path.Combine(logDir, baseName + "." + (i + 1) + extension);
                    
                    try
                    {
                        if (File.Exists(oldFile))
                        {
                            if (i >= MAX_LOG_FILES - 1)
                            {
                                File.Delete(oldFile);
                            }
                            else
                            {
                                if (File.Exists(newFile))
                                    File.Delete(newFile);
                                File.Move(oldFile, newFile);
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                string rotatedFile = Path.Combine(logDir, baseName + ".1" + extension);
                try
                {
                    if (File.Exists(rotatedFile))
                        File.Delete(rotatedFile);
                    File.Move(logFile, rotatedFile);
                    _currentLogSize = 0;
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
