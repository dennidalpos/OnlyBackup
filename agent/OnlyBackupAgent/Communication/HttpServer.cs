using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using OnlyBackupAgent.FileSystem;

namespace OnlyBackupAgent.Communication
{
    public class HttpServer
    {
        private HttpListener listener;
        private Thread listenerThread;
        private bool isRunning;
        private readonly int port;
        private readonly JavaScriptSerializer jsonSerializer;
        private readonly BackupEngine backupEngine;
        private readonly ServerCommunication serverComm;

        public HttpServer(int port, ServerCommunication serverComm = null)
        {
            this.port = port;
            this.jsonSerializer = new JavaScriptSerializer();
            this.serverComm = serverComm;
            this.backupEngine = new BackupEngine(serverComm);
        }

        public void Start()
        {
            if (isRunning)
                return;

            listener = new HttpListener();
            listener.Prefixes.Add(String.Format("http://+:{0}/", port));

            try
            {
                listener.Start();
                isRunning = true;

                listenerThread = new Thread(ListenForRequests);
                listenerThread.Start();
            }
            catch (Exception ex)
            {
                throw new Exception(String.Format("Impossibile avviare HTTP server su porta {0}: {1}", port, ex.Message), ex);
            }
        }

        public void Stop()
        {
            if (!isRunning)
                return;

            isRunning = false;

            if (listener != null)
            {
                listener.Stop();
                listener.Close();
            }

            if (listenerThread != null && listenerThread.IsAlive)
            {
                listenerThread.Join(5000);
            }
        }

        private void ListenForRequests()
        {
            while (isRunning)
            {
                try
                {
                    var context = listener.BeginGetContext(HandleRequest, listener);
                    context.AsyncWaitHandle.WaitOne();
                }
                catch (Exception)
                {
                    if (!isRunning)
                        break;
                }
            }
        }

        private void HandleRequest(IAsyncResult result)
        {
            if (!isRunning)
                return;

            HttpListener listener = (HttpListener)result.AsyncState;
            HttpListenerContext context = null;

            try
            {
                context = listener.EndGetContext(result);
            }
            catch
            {
                return;
            }

            try
            {
                ProcessRequest(context);
            }
            catch (Exception ex)
            {
                SendErrorResponse(context, 500, String.Format("Errore interno: {0}", ex.Message));
            }
        }

        private void ProcessRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;

            string path = request.Url.AbsolutePath;

            if (path == "/health")
            {
                HandleHealthCheck(context);
            }
            else if (path == "/backup" && request.HttpMethod == "POST")
            {
                HandleBackupRequest(context);
            }
            else if (path == "/filesystem/list" && request.HttpMethod == "POST")
            {
                HandleFileSystemListRequest(context);
            }
            else
            {
                SendErrorResponse(context, 404, "Endpoint non trovato");
            }
        }

        private void HandleHealthCheck(HttpListenerContext context)
        {
            var responseObj = new
            {
                status = "ok",
                hostname = Environment.MachineName,
                timestamp = DateTime.UtcNow.ToString("o")
            };

            SendJsonResponse(context, 200, responseObj);
        }

        private void HandleBackupRequest(HttpListenerContext context)
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    requestBody = reader.ReadToEnd();
                }

                var requestData = jsonSerializer.Deserialize<dynamic>(requestBody);

                // Estrai job_id se presente (per heartbeat)
                string jobId = null;
                if (requestData.ContainsKey("job_id"))
                {
                    jobId = requestData["job_id"];
                }

                var result = backupEngine.PerformBackup(
                    requestData["sources"],
                    requestData["destination"],
                    requestData["options"],
                    jobId
                );

                if (result.Success)
                {
                    SendJsonResponse(context, 200, result);
                }
                else
                {
                    SendJsonResponse(context, 500, result);
                }
            }
            catch (BackupException bex)
            {
                var errorResult = new
                {
                    Success = false,
                    ErrorCode = bex.ErrorCode,
                    ErrorMessage = bex.Message,
                    AffectedPath = bex.AffectedPath,
                    WindowsErrorCode = bex.WindowsErrorCode,
                    Errors = new[] { bex.Message }
                };
                SendJsonResponse(context, 500, errorResult);
            }
            catch (Exception ex)
            {
                var errorResult = new
                {
                    Success = false,
                    ErrorCode = "UNKNOWN_ERROR",
                    ErrorMessage = ex.Message,
                    AffectedPath = (string)null,
                    WindowsErrorCode = (int?)null,
                    Errors = new[] { ex.Message, ex.GetType().Name }
                };
                SendJsonResponse(context, 500, errorResult);
            }
        }

        private void HandleFileSystemListRequest(HttpListenerContext context)
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    requestBody = reader.ReadToEnd();
                }

                var requestData = jsonSerializer.Deserialize<dynamic>(requestBody);
                string path = requestData["path"];

                var result = FileSystemOperations.ListDirectory(path);

                SendJsonResponse(context, 200, result);
            }
            catch (Exception ex)
            {
                SendErrorResponse(context, 500, String.Format("Errore lettura filesystem: {0}", ex.Message));
            }
        }

        private void SendJsonResponse(HttpListenerContext context, int statusCode, object data)
        {
            var response = context.Response;
            response.StatusCode = statusCode;
            response.ContentType = "application/json";

            string json = jsonSerializer.Serialize(data);
            byte[] buffer = Encoding.UTF8.GetBytes(json);

            response.ContentLength64 = buffer.Length;
            response.OutputStream.Write(buffer, 0, buffer.Length);
            response.OutputStream.Close();
        }

        private void SendErrorResponse(HttpListenerContext context, int statusCode, string message)
        {
            var errorObj = new { error = message };
            SendJsonResponse(context, statusCode, errorObj);
        }
    }
}
