using System;
using System.Collections.Generic;
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
            else if (path == "/filesystem/delete" && request.HttpMethod == "POST")
            {
                HandleFileSystemDeleteRequest(context);
            }
            else if (path == "/backups/list" && request.HttpMethod == "POST")
            {
                HandleBackupsListRequest(context);
            }
            else if (path == "/backups/job" && request.HttpMethod == "POST")
            {
                HandleJobBackupsListRequest(context);
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
                    Errors = new[] { bex.Message },
                    Stats = bex.Stats,
                    SkippedFiles = bex.SkippedFiles,
                    BlockedFiles = bex.BlockedFiles,
                    BytesProcessed = bex.BytesProcessed
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

        private void HandleFileSystemDeleteRequest(HttpListenerContext context)
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    requestBody = reader.ReadToEnd();
                }

                var requestData = jsonSerializer.Deserialize<dynamic>(requestBody);
                if (!requestData.ContainsKey("paths"))
                {
                    SendErrorResponse(context, 400, "Lista percorsi mancante");
                    return;
                }

                var robocopy = new RobocopyEngine();
                var results = new System.Collections.Generic.List<object>();

                foreach (var item in (object[])requestData["paths"])
                {
                    string target = null;
                    System.Collections.Generic.Dictionary<string, object> credentialsDict = null;

                    if (item is string)
                    {
                        target = item as string;
                    }
                    else if (item is System.Collections.Generic.Dictionary<string, object>)
                    {
                         var itemDict = item as System.Collections.Generic.Dictionary<string, object>;
                         target = itemDict.ContainsKey("path") ? itemDict["path"].ToString() : null;
                         if (itemDict.ContainsKey("credentials"))
                         {
                             credentialsDict = itemDict["credentials"] as System.Collections.Generic.Dictionary<string, object>;
                         }
                    }

                    var credentials = NetworkCredentials.FromDictionary(credentialsDict);
                    
                    RobocopyResult deleteResult;
                    
                    if (credentials != null && credentials.HasCredentials)
                    {
                        using (var netManager = new NetworkShareManager())
                        {
                            netManager.Connect(target, credentials);
                            deleteResult = robocopy.DeleteDirectory(target);
                        }
                    }
                    else
                    {
                        deleteResult = robocopy.DeleteDirectory(target);
                    }

                    results.Add(new
                    {
                        path = target,
                        success = deleteResult.Success,
                        status = deleteResult.Success ? "deleted" : "error",
                        warning = deleteResult.HasWarnings ? deleteResult.WarningMessage : null,
                        error = deleteResult.Success ? null : deleteResult.ErrorMessage,
                        exitCode = deleteResult.ExitCode
                    });
                }

                var responseObj = new
                {
                    success = true,
                    results = results
                };

                SendJsonResponse(context, 200, responseObj);
            }
            catch (Exception ex)
            {
                SendErrorResponse(context, 500, ex.Message);
            }
        }

        private void HandleBackupsListRequest(HttpListenerContext context)
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    requestBody = reader.ReadToEnd();
                }

                var requestData = jsonSerializer.Deserialize<dynamic>(requestBody);
                string destinationPath = requestData["destination_path"];
                string jobLabel = requestData.ContainsKey("job_label") ? requestData["job_label"] : null;

                if (String.IsNullOrWhiteSpace(destinationPath))
                {
                    SendErrorResponse(context, 400, "destination_path richiesto");
                    return;
                }

                var backups = new System.Collections.Generic.List<object>();
                var normalizedPath = FileSystemOperations.NormalizePath(destinationPath);

                if (!Directory.Exists(normalizedPath))
                {
                    SendJsonResponse(context, 200, new { backups = backups });
                    return;
                }

                var directories = Directory.GetDirectories(normalizedPath);
                foreach (var dir in directories)
                {
                    try
                    {
                        var dirInfo = new DirectoryInfo(dir);
                        var dirName = dirInfo.Name;

                        bool isBackup = false;
                        int retentionIndex = 0;

                        if (!String.IsNullOrWhiteSpace(jobLabel))
                        {
                            var slotMatch = System.Text.RegularExpressions.Regex.Match(
                                dirName,
                                String.Format("^{0}_.+_s(\\d+)$", System.Text.RegularExpressions.Regex.Escape(jobLabel))
                            );
                            if (slotMatch.Success)
                            {
                                isBackup = true;
                                int.TryParse(slotMatch.Groups[1].Value, out retentionIndex);
                            }
                        }

                        if (!isBackup)
                        {
                            var genericMatch = System.Text.RegularExpressions.Regex.Match(dirName, "_s(\\d+)$");
                            if (genericMatch.Success)
                            {
                                isBackup = true;
                                int.TryParse(genericMatch.Groups[1].Value, out retentionIndex);
                            }
                        }

                        if (isBackup)
                        {
                            var manifestPath = Path.Combine(dir, "backup.manifest.json");
                            bool hasManifest = File.Exists(manifestPath);

                            backups.Add(new
                            {
                                name = dirName,
                                path = dir,
                                retention_index = retentionIndex,
                                created = dirInfo.CreationTimeUtc.ToString("o"),
                                modified = dirInfo.LastWriteTimeUtc.ToString("o"),
                                has_manifest = hasManifest,
                                legacy = !hasManifest
                            });
                        }
                    }
                    catch
                    {
                    }
                }

                SendJsonResponse(context, 200, new { backups = backups });
            }
            catch (Exception ex)
            {
                SendErrorResponse(context, 500, String.Format("Errore lista backup: {0}", ex.Message));
            }
        }

        private void HandleJobBackupsListRequest(HttpListenerContext context)
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    requestBody = reader.ReadToEnd();
                }

                var requestData = jsonSerializer.Deserialize<dynamic>(requestBody);
                if (!requestData.ContainsKey("mappings"))
                {
                    SendErrorResponse(context, 400, "mappings richieste");
                    return;
                }

                string jobLabel = requestData.ContainsKey("job_label") ? requestData["job_label"] : null;

                var mappings = new System.Collections.Generic.List<object>();
                int index = 0;

                foreach (var rawMapping in (object[])requestData["mappings"])
                {
                    try
                    {
                        var mapDict = rawMapping as System.Collections.Generic.Dictionary<string, object>;
                        string destinationPath = mapDict != null && mapDict.ContainsKey("destination_path") ? mapDict["destination_path"].ToString() : null;
                        string sourcePath = mapDict != null && mapDict.ContainsKey("source_path") ? mapDict["source_path"].ToString() : null;
                        string label = mapDict != null && mapDict.ContainsKey("label") ? mapDict["label"].ToString() : null;
                        string mode = mapDict != null && mapDict.ContainsKey("mode") ? mapDict["mode"].ToString().ToLowerInvariant() : "copy";
                        
                        var credentialsDict = mapDict != null && mapDict.ContainsKey("credentials") ? mapDict["credentials"] as System.Collections.Generic.Dictionary<string, object> : null;
                        var credentials = NetworkCredentials.FromDictionary(credentialsDict);
                        


                        var mappingResult = new System.Collections.Generic.Dictionary<string, object>();
                        mappingResult["index"] = index;
                        mappingResult["label"] = String.IsNullOrWhiteSpace(label) ? String.Format("Mappatura {0}", index + 1) : label;
                        mappingResult["destination_path"] = destinationPath ?? String.Empty;
                        mappingResult["mode"] = mode;
                        mappingResult["backups"] = new System.Collections.Generic.List<object>();

                        if (String.IsNullOrWhiteSpace(destinationPath))
                        {
                            mappingResult["error"] = "Percorso destinazione mancante";
                            mappings.Add(mappingResult);
                            index++;
                            continue;
                        }

                        var listing = ListBackupsForMapping(destinationPath, sourcePath, jobLabel, mode, credentials);
                        mappingResult["backups"] = listing;
                        mappings.Add(mappingResult);
                    }
                    catch (Exception innerEx)
                    {
                        var errorResult = new System.Collections.Generic.Dictionary<string, object>();
                        errorResult["index"] = index;
                        errorResult["label"] = String.Format("Mappatura {0}", index + 1);
                        errorResult["destination_path"] = null;
                        errorResult["mode"] = "copy";
                        errorResult["backups"] = new System.Collections.Generic.List<object>();
                        errorResult["error"] = innerEx.Message;
                        mappings.Add(errorResult);
                    }

                    index++;
                }

                SendJsonResponse(context, 200, new { mappings = mappings });
            }
            catch (Exception ex)
            {
                SendErrorResponse(context, 500, String.Format("Errore lista backup job: {0}", ex.Message));
            }
        }

        private System.Collections.Generic.List<object> ListBackupsForMapping(string destinationPath, string sourcePath, string jobLabel, string mode, NetworkCredentials credentials = null)
        {
            var backups = new System.Collections.Generic.List<object>();
            var normalizedPath = FileSystemOperations.NormalizePath(destinationPath);
            var longPath = FileSystemOperations.NormalizeLongPath(normalizedPath);
            var normalizedSource = !String.IsNullOrWhiteSpace(sourcePath) ? FileSystemOperations.NormalizePath(sourcePath) : null;

            NetworkShareManager netManager = null;
            try
            {
                if (credentials != null && credentials.HasCredentials)
                {
                    netManager = new NetworkShareManager();
                    netManager.Connect(destinationPath, credentials);
                }

                if (String.IsNullOrWhiteSpace(normalizedPath) || !Directory.Exists(longPath))
                {
                    return backups;
                }

                if (!String.IsNullOrWhiteSpace(mode) && mode.ToLowerInvariant() == "sync")
                {
                    try
                    {
                        var info = new DirectoryInfo(longPath);
                        backups.Add(new
                        {
                            name = info.Name,
                            path = NormalizeOutputPath(info.FullName),
                            retention_index = (int?)null,
                            created = info.CreationTimeUtc.ToString("o"),
                            modified = info.LastWriteTimeUtc.ToString("o"),
                            has_manifest = File.Exists(Path.Combine(info.FullName, "backup.manifest.json")),
                            legacy = false
                        });
                    }
                    catch { }

                    return backups;
                }

                var directories = Directory.GetDirectories(longPath);
                foreach (var dir in directories)
                {
                    try
                    {
                        var dirInfo = new DirectoryInfo(dir);
                        var dirName = dirInfo.Name;

                        bool isBackup = false;
                        bool isTimestamp = false;
                        int retentionIndex = 0;

                        if (!String.IsNullOrWhiteSpace(jobLabel))
                        {
                            var slotMatch = System.Text.RegularExpressions.Regex.Match(
                                dirName,
                                String.Format("^{0}_.+_s(\\d+)$", System.Text.RegularExpressions.Regex.Escape(jobLabel))
                            );
                            if (slotMatch.Success)
                            {
                                isBackup = true;
                                int.TryParse(slotMatch.Groups[1].Value, out retentionIndex);
                            }
                        }

                        if (!isBackup)
                        {
                            var genericMatch = System.Text.RegularExpressions.Regex.Match(dirName, "_s(\\d+)$");
                            if (genericMatch.Success)
                            {
                                isBackup = true;
                                int.TryParse(genericMatch.Groups[1].Value, out retentionIndex);
                            }
                            else
                            {
                                isTimestamp = System.Text.RegularExpressions.Regex.IsMatch(
                                    dirName,
                                    @"^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$"
                                );
                            }
                        }

                        var manifestPath = Path.Combine(dir, "backup.manifest.json");
                        bool hasManifest = File.Exists(manifestPath);

                        if (isBackup || hasManifest || isTimestamp)
                        {
                             if (hasManifest && !String.IsNullOrWhiteSpace(normalizedSource))
                             {
                                 try
                                 {
                                     string manifestContent = File.ReadAllText(manifestPath);
                                     var manifest = jsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(manifestContent);
                                     
                                     bool sourceMatch = false;
                                     if (manifest.ContainsKey("sources"))
                                     {
                                         var sourcesList = manifest["sources"] as System.Collections.IEnumerable;
                                         if (sourcesList != null && !(manifest["sources"] is string))
                                         {
                                             foreach (object s in sourcesList)
                                             {
                                                 if (s != null && FileSystemOperations.PathsAreEqual(s.ToString(), normalizedSource))
                                                 {
                                                     sourceMatch = true;
                                                     break;
                                                 }
                                             }
                                         }
                                         else if (manifest["sources"] is string)
                                         {
                                             if (FileSystemOperations.PathsAreEqual(manifest["sources"].ToString(), normalizedSource))
                                             {
                                                 sourceMatch = true;
                                             }
                                         }
                                     }

                                     if (!sourceMatch)
                                     {
                                         continue;
                                     }
                                 }
                                 catch { } 
                             }

                            backups.Add(new
                            {
                                name = dirName,
                                path = NormalizeOutputPath(dir),
                                retention_index = retentionIndex,
                                created = dirInfo.CreationTimeUtc.ToString("o"),
                                modified = dirInfo.LastWriteTimeUtc.ToString("o"),
                                has_manifest = hasManifest,
                                legacy = !hasManifest
                            });
                        }
                    }
                    catch
                    {
                    }
                }
            }
            finally
            {
                if (netManager != null)
                {
                    netManager.Dispose();
                }
            }

            return backups;
        }




        private string NormalizeOutputPath(string path)
        {
            const string longPrefix = "\\\\?\\";
            const string longUncPrefix = "\\\\?\\UNC\\";

            if (path.StartsWith(longUncPrefix))
            {
                return "\\\\" + path.Substring(longUncPrefix.Length);
            }

            if (path.StartsWith(longPrefix))
            {
                return path.Substring(longPrefix.Length);
            }

            return path;
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
