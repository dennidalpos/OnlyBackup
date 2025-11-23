using System;
using System.Collections.Generic;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using WebSocketSharp;

namespace BackupAgentService
{
    public class WebSocketClient : IDisposable
    {
        private readonly string _serverUrl;
        private readonly JobScheduler _scheduler;
        private readonly Action<string> _log;
        private WebSocket _ws;
        private readonly object _sync = new object();
        private Timer _reconnectTimer;
        private bool _disposed;
        private string _agentId;
        private string _hostname;
        private string[] _ipAddresses;
        private string _osVersion;
        private string _cachedHeartbeatJson;

        public WebSocketClient(string serverUrl, JobScheduler scheduler, Action<string> log)
        {
            _serverUrl = serverUrl;
            _scheduler = scheduler;
            _log = log;
            InitSystemInfo();
        }

        private void InitSystemInfo()
        {
            _hostname = Environment.MachineName;
            _osVersion = Environment.OSVersion.ToString();
            try
            {
                var ips = new List<string>();
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up)
                        continue;
                    var ipProps = nic.GetIPProperties();
                    foreach (var ua in ipProps.UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily == AddressFamily.InterNetwork)
                            ips.Add(ua.Address.ToString());
                    }
                }
                _ipAddresses = ips.ToArray();
            }
            catch
            {
                _ipAddresses = new[] { "0.0.0.0" };
            }
            _agentId = _hostname;
            CacheHeartbeatMessage();
        }

        private void CacheHeartbeatMessage()
        {
            var msg = new
            {
                type = "heartbeat",
                payload = new
                {
                    agentId = _agentId,
                    hostname = _hostname,
                    ipAddresses = _ipAddresses,
                    osVersion = _osVersion
                }
            };
            _cachedHeartbeatJson = JsonConvert.SerializeObject(msg);
        }

        public void Connect()
        {
            lock (_sync)
            {
                if (_ws != null)
                {
                    _ws.OnOpen -= Ws_OnOpen;
                    _ws.OnClose -= Ws_OnClose;
                    _ws.OnMessage -= Ws_OnMessage;
                    _ws.OnError -= Ws_OnError;
                    _ws.Close();
                    _ws = null;
                }
                _ws = new WebSocket(_serverUrl);
                _ws.OnOpen += Ws_OnOpen;
                _ws.OnClose += Ws_OnClose;
                _ws.OnError += Ws_OnError;
                _ws.OnMessage += Ws_OnMessage;
                _log("Connecting to " + _serverUrl);
                _ws.ConnectAsync();
            }
        }

        private void Ws_OnOpen(object sender, EventArgs e)
        {
            _log("WebSocket connected, sending register");
            SendRegister();
        }

        private void Ws_OnClose(object sender, CloseEventArgs e)
        {
            _log("WebSocket closed: " + e.Reason + " (" + e.Code + ")");
            ScheduleReconnect();
        }

        private void Ws_OnError(object sender, ErrorEventArgs e)
        {
            _log("WebSocket error: " + e.Message);
        }

        private void Ws_OnMessage(object sender, MessageEventArgs e)
        {
            try
            {
                var obj = JObject.Parse(e.Data);
                var type = (string)obj["type"];
                var payload = obj["payload"];
                var requestId = (string)obj["requestId"];

                if (type == "registered" || type == "config_update")
                {
                    var jobs = payload["jobs"] != null
                        ? payload["jobs"].ToObject<List<JobConfig>>()
                        : new List<JobConfig>();
                    if (_scheduler != null)
                        _scheduler.UpdateJobs(jobs);
                    _log("Received config with " + (jobs != null ? jobs.Count : 0) + " jobs");
                }
                else if (type == "run_job")
                {
                    string jobId = (string)payload["jobId"];
                    if (_scheduler != null)
                        _scheduler.RunJobNow(jobId);
                }
                else if (type == "filesystem_browse")
                {
                    string path = (string)payload["path"];
                    var fs = FileSystemHelper.Browse(path);
                    var resp = new
                    {
                        type = "filesystem_response",
                        requestId = requestId,
                        payload = fs
                    };
                    SendObject(resp);
                }
                else if (type == "validate_destinations")
                {
                    var dests = payload["destinations"] != null
                        ? payload["destinations"].ToObject<List<DestinationConfig>>()
                        : new List<DestinationConfig>();
                    var results = new List<object>();
                    foreach (var dest in dests)
                    {
                        bool ok = false;
                        string err = null;
                        try
                        {
                            var pathValidation = FileSystemHelper.ValidatePath(dest.path);
                            if (!pathValidation.IsValid)
                            {
                                ok = false;
                                err = pathValidation.ErrorMessage;
                            }
                            else if (dest.credentials != null &&
                                     !string.IsNullOrEmpty(dest.path) &&
                                     dest.path.StartsWith(@"\\"))
                            {
                                var testResult = NetworkConnection.TestConnection(dest.path, dest.credentials);
                                ok = testResult.Success;
                                if (!ok)
                                    err = testResult.ErrorMessage;
                                if (ok)
                                    ok = FileSystemHelper.CanAccessDestination(dest.path);
                            }
                            else
                            {
                                ok = FileSystemHelper.CanAccessDestination(dest.path);
                            }
                        }
                        catch (Exception ex)
                        {
                            ok = false;
                            err = ex.Message;
                        }
                        results.Add(new
                        {
                            path = dest.path,
                            ok = ok,
                            errorMessage = err
                        });
                    }
                    var resp = new
                    {
                        type = "validate_destinations_result",
                        requestId = requestId,
                        payload = new
                        {
                            results = results
                        }
                    };
                    SendObject(resp);
                }
            }
            catch (Exception ex)
            {
                _log("Error handling WS message: " + ex);
            }
        }

        private void ScheduleReconnect()
        {
            if (_disposed)
                return;
            if (_reconnectTimer != null)
            {
                _reconnectTimer.Dispose();
                _reconnectTimer = null;
            }
            _reconnectTimer = new Timer(_ =>
            {
                _log("Attempting reconnect");
                Connect();
            }, null, 5000, Timeout.Infinite);
        }

        private void SendRegister()
        {
            var msg = new
            {
                type = "register",
                payload = new
                {
                    agentId = _agentId,
                    hostname = _hostname,
                    ipAddresses = _ipAddresses,
                    osVersion = _osVersion
                }
            };
            SendObject(msg);
        }

        public void SendHeartbeat()
        {
            try
            {
                lock (_sync)
                {
                    if (_ws != null && _ws.ReadyState == WebSocketState.Open && !string.IsNullOrEmpty(_cachedHeartbeatJson))
                        _ws.Send(_cachedHeartbeatJson);
                }
            }
            catch (Exception ex)
            {
                _log("Error sending heartbeat: " + ex);
            }
        }

        public void SendJobResult(JobResult result)
        {
            var msg = new
            {
                type = "job_result",
                payload = result
            };
            SendObject(msg);
        }

        private void SendObject(object obj)
        {
            try
            {
                string json = JsonConvert.SerializeObject(obj);
                lock (_sync)
                {
                    if (_ws != null && _ws.ReadyState == WebSocketState.Open)
                        _ws.Send(json);
                }
            }
            catch (Exception ex)
            {
                _log("Error sending WS message: " + ex);
            }
        }

        public void Dispose()
        {
            _disposed = true;
            lock (_sync)
            {
                if (_ws != null)
                {
                    _ws.Close();
                    _ws = null;
                }
            }
            if (_reconnectTimer != null)
            {
                _reconnectTimer.Dispose();
                _reconnectTimer = null;
            }
        }
    }
}
