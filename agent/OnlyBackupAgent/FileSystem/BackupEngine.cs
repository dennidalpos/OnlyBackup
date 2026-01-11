using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Web.Script.Serialization;
using OnlyBackupAgent.Communication;

namespace OnlyBackupAgent.FileSystem
{
    public class BackupEngine
    {
        private NetworkShareManager _shareManager = null;
        private ServerCommunication _serverComm = null;
        private List<string> _skippedFiles = new List<string>();

        private int _totalFiles = 0;
        private int _copiedFiles = 0;
        private int _skippedFilesCount = 0;
        private int _failedFiles = 0;

        private class RunLoggingContext
        {
            public string Hostname { get; set; }
            public string JobId { get; set; }
            public string RunId { get; set; }
            public string RunTimestamp { get; set; }
            public string LogFilePath { get; set; }
            public string RunIndexPath { get; set; }
            public string JobDirectoryPath { get; set; }
            public DateTime StartedAtUtc { get; set; }
        }

        public BackupEngine(ServerCommunication serverComm = null)
        {
            _serverComm = serverComm;
        }

        private RunLoggingContext PrepareRunLogging(string hostname, string jobId, IDictionary<string, object> options)
        {
            string runId = null;
            string rawTimestamp = null;
            string mappingSegment = null;

            if (options != null)
            {
                if (options.ContainsKey("run_id") && options["run_id"] != null)
                {
                    runId = options["run_id"].ToString();
                }

                if (options.ContainsKey("run_timestamp") && options["run_timestamp"] != null)
                {
                    rawTimestamp = options["run_timestamp"].ToString();
                }

                if (options.ContainsKey("mapping_label") && options["mapping_label"] != null)
                {
                    mappingSegment = options["mapping_label"].ToString();
                }

                if (String.IsNullOrWhiteSpace(mappingSegment) && options.ContainsKey("mapping_index") && options["mapping_index"] != null)
                {
                    mappingSegment = String.Format("m{0}", options["mapping_index"].ToString());
                }
            }

            string sanitizedJobId = String.IsNullOrWhiteSpace(jobId) ? "manual" : SanitizePathSegment(jobId);
            string runTimestamp = SanitizePathSegment(rawTimestamp);

            if (String.IsNullOrWhiteSpace(runTimestamp))
            {
                runTimestamp = DateTime.Now.ToString("yyyy_MM_dd_HH_mm_ss");
            }

            string baseDir = Environment.OSVersion.Platform == PlatformID.Win32NT
                ? @"C:\\BackupConsole\\logs"
                : "/var/log/backup-console";

            string hostDir = Path.Combine(baseDir, SanitizePathSegment(hostname));
            string jobDir = Path.Combine(hostDir, sanitizedJobId);

            try
            {
                Directory.CreateDirectory(jobDir);
            }
            catch { }

            string mappingSuffix = SanitizePathSegment(mappingSegment);
            string fileBase = String.IsNullOrWhiteSpace(mappingSuffix) ? runTimestamp : String.Format("{0}_{1}", runTimestamp, mappingSuffix);

            string logFilePath = Path.Combine(jobDir, String.Format("{0}.log", fileBase));
            string runIndexPath = Path.Combine(jobDir, String.Format("{0}.run.json", fileBase));

            return new RunLoggingContext
            {
                Hostname = hostname,
                JobId = sanitizedJobId,
                RunId = runId,
                RunTimestamp = runTimestamp,
                LogFilePath = logFilePath,
                RunIndexPath = runIndexPath,
                JobDirectoryPath = jobDir,
                StartedAtUtc = DateTime.UtcNow
            };
        }

        private string SanitizePathSegment(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return null;

            foreach (var invalid in Path.GetInvalidFileNameChars())
            {
                value = value.Replace(invalid, '_');
            }

            return value.Trim();
        }

        private void WriteRunIndex(
            RunLoggingContext context,
            List<string> sources,
            string destination,
            bool success,
            List<RobocopyResult> operations,
            long bytesProcessed,
            BackupResult finalResult,
            IEnumerable<string> warnings,
            IEnumerable<string> errors
        )
        {
            if (context == null)
                return;

            try
            {
                var serializer = new JavaScriptSerializer();
                var payload = new Dictionary<string, object>();

                payload["hostname"] = context.Hostname;
                payload["job_id"] = context.JobId;
                payload["run_id"] = context.RunId;
                payload["run_timestamp"] = context.RunTimestamp;
                payload["start_utc"] = context.StartedAtUtc.ToString("o");
                payload["end_utc"] = DateTime.UtcNow.ToString("o");
                payload["status"] = success ? "success" : "error";
                payload["log_path"] = context.LogFilePath;
                payload["bytes_processed"] = bytesProcessed;
                payload["destination"] = destination;
                payload["sources"] = sources;

                if (finalResult != null)
                {
                    payload["error_code"] = finalResult.ErrorCode;
                    payload["error_message"] = finalResult.ErrorMessage;
                    payload["exit_code"] = finalResult.ExitCode;
                    payload["command"] = finalResult.CommandUsed;
                }

                var ops = new List<object>();
                foreach (var op in operations)
                {
                    ops.Add(new
                    {
                        source = op.SourcePath,
                        destination = op.DestinationPath,
                        command = op.CommandLine,
                        exit_code = op.ExitCode,
                        start_utc = op.StartedAtUtc.HasValue ? op.StartedAtUtc.Value.ToString("o") : null,
                        end_utc = op.EndedAtUtc.HasValue ? op.EndedAtUtc.Value.ToString("o") : null,
                        log_path = op.LogFilePath,
                        stats = new
                        {
                            total_files = op.TotalFiles,
                            copied_files = op.CopiedFiles,
                            skipped_files = op.SkippedFiles,
                            failed_files = op.FailedFiles,
                            bytes_copied = op.BytesCopied
                        }
                    });
                }

                payload["operations"] = ops;
                payload["warnings"] = warnings;
                payload["errors"] = errors;

                File.WriteAllText(context.RunIndexPath, serializer.Serialize(payload));
            }
            catch { }
        }

        public BackupResult PerformBackup(object sources, string destination, object options, string jobId = null)
        {
            var errorsList = new List<string>();
            var optionsDict = options as IDictionary<string, object>;
            long bytesProcessed = 0;
            string hostname = Environment.MachineName;
            var operations = new List<RobocopyResult>();
            var loggingContext = PrepareRunLogging(hostname, jobId, optionsDict);
            bool appendLog = false;
            int logRetentionDays = ExtractRetentionDays(optionsDict, "log_retention_days", 180);
            int runIndexRetentionDays = ExtractRetentionDays(optionsDict, "log_index_retention_days", Math.Max(logRetentionDays, 365));
            string backupTarget = null;
            string mode = optionsDict != null && optionsDict.ContainsKey("mode") && optionsDict["mode"] != null
                ? optionsDict["mode"].ToString().ToLowerInvariant()
                : "copy";
            bool isSyncMode = String.Equals(mode, "sync", StringComparison.OrdinalIgnoreCase);
            string logPayload = optionsDict != null && optionsDict.ContainsKey("log_payload") && optionsDict["log_payload"] != null
                ? optionsDict["log_payload"].ToString().ToLowerInvariant()
                : "tail";
            int logMaxBytes = 262144;

            if (optionsDict != null && optionsDict.ContainsKey("log_max_bytes") && optionsDict["log_max_bytes"] != null)
            {
                int parsed;
                if (Int32.TryParse(optionsDict["log_max_bytes"].ToString(), out parsed) && parsed > 0)
                {
                    logMaxBytes = parsed;
                }
            }

            if (_serverComm != null && !String.IsNullOrEmpty(jobId))
            {
                try
                {
                    _serverComm.SendHeartbeat(hostname, "in_progress", jobId);
                }
                catch { }
            }

            try
            {
                string normalizedDestination = FileSystemOperations.NormalizePath(destination);

                var uncValidation = ValidateUncPath(normalizedDestination);
                if (!uncValidation.Valid)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    var errorResult = BackupResult.CreateError(
                        uncValidation.ErrorCode,
                        uncValidation.ErrorMessage,
                        normalizedDestination
                    );
                    PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                    WriteRunIndex(loggingContext, ParseSources(sources), normalizedDestination, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                    return errorResult;
                }

                var accessResult = EnsureDestinationAccessible(normalizedDestination, optionsDict);
                if (!accessResult.Success)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    PopulateRunMetadata(accessResult, loggingContext, operations, bytesProcessed);
                    WriteRunIndex(loggingContext, ParseSources(sources), normalizedDestination, false, operations, bytesProcessed, accessResult, _skippedFiles, accessResult.Errors);
                    return accessResult;
                }

                var writeTest = TestWriteAccess(normalizedDestination);
                if (!writeTest.Success)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    PopulateRunMetadata(writeTest, loggingContext, operations, bytesProcessed);
                    WriteRunIndex(loggingContext, ParseSources(sources), normalizedDestination, false, operations, bytesProcessed, writeTest, _skippedFiles, writeTest.Errors);
                    return writeTest;
                }

                backupTarget = isSyncMode ? normalizedDestination : BuildBackupTargetPath(normalizedDestination);

                try
                {
                    Directory.CreateDirectory(backupTarget);
                }
                catch (Exception dirEx)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    var errorResult = BackupResult.CreateError(
                        BackupErrorCodes.DESTINATION_WRITE_ERROR,
                        String.Format("Impossibile creare la cartella di destinazione {0}: {1}", backupTarget, dirEx.Message),
                        backupTarget
                    );
                    PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                    WriteRunIndex(loggingContext, ParseSources(sources), backupTarget, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                    return errorResult;
                }

                List<string> sourceList = ParseSources(sources);

                foreach (var source in sourceList)
                {
                    try
                    {
                        RobocopyResult robocopyResult;
                        bytesProcessed += ProcessSource(source, backupTarget, loggingContext, appendLog, out robocopyResult, isSyncMode, logPayload, logMaxBytes);
                        if (robocopyResult != null)
                        {
                            operations.Add(robocopyResult);
                            appendLog = true;
                        }
                    }
                    catch (BackupException bex)
                    {
                        SendBackupCompletedHeartbeat(hostname, jobId, false);
                        var errorResult = BackupResult.CreateError(
                            bex.ErrorCode,
                            bex.Message,
                            bex.AffectedPath,
                            bex.WindowsErrorCode
                        );

                        errorResult.Stats = bex.Stats;
                        errorResult.BytesProcessed = bex.BytesProcessed;

                        if (bex.SkippedFiles != null && bex.SkippedFiles.Count > 0)
                        {
                            errorResult.SkippedFiles = bex.SkippedFiles;
                        }

                        if (bex.BlockedFiles != null && bex.BlockedFiles.Count > 0)
                        {
                            errorResult.BlockedFiles = bex.BlockedFiles;
                        }

                        PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                        WriteRunIndex(loggingContext, sourceList, destination, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                        return errorResult;
                    }
                    catch (Exception ex)
                    {
                        errorsList.Add(String.Format("Errore backup di {0}: {1}", source, ex.Message));
                    }
                }

                if (errorsList.Count > 0)
                {
                    string firstSource = sourceList.Count > 0 ? sourceList[0] : null;
                    var errorResult = BackupResult.CreateError(
                        BackupErrorCodes.UNKNOWN_ERROR,
                        String.Join("; ", errorsList.ToArray()),
                        firstSource
                    );

                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                    WriteRunIndex(loggingContext, sourceList, backupTarget, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                    return errorResult;
                }

                var stats = new BackupStats
                {
                    TotalFiles = _totalFiles,
                    CopiedFiles = _copiedFiles,
                    SkippedFilesCount = _skippedFilesCount,
                    FailedFiles = _failedFiles
                };

                var successResult = BackupResult.CreateSuccess(bytesProcessed, stats);
                if (_skippedFiles.Count > 0)
                {
                    successResult.SkippedFiles = _skippedFiles;
                }

                PopulateRunMetadata(successResult, loggingContext, operations, bytesProcessed);

                GenerateBackupManifest(backupTarget, loggingContext, sourceList, bytesProcessed, stats, optionsDict);

                if (!isSyncMode)
                {
                    int configuredMaxBackups = ExtractMaxBackups(optionsDict);
                    var retentionEvents = ApplyRetentionPolicy(normalizedDestination, configuredMaxBackups, loggingContext);
                    if (retentionEvents != null && retentionEvents.Count > 0)
                    {
                        SaveRetentionEvents(loggingContext, retentionEvents);
                    }
                }

                WriteRunIndex(loggingContext, sourceList, backupTarget, true, operations, bytesProcessed, successResult, _skippedFiles, null);
                SendBackupCompletedHeartbeat(hostname, jobId, true);
                return successResult;
            }
            catch (BackupException bex)
            {
                var errorResult = BackupResult.CreateError(
                    bex.ErrorCode,
                    bex.Message,
                    bex.AffectedPath,
                    bex.WindowsErrorCode
                );

                errorResult.Stats = bex.Stats;
                errorResult.BytesProcessed = bex.BytesProcessed;

                if (bex.SkippedFiles != null && bex.SkippedFiles.Count > 0)
                {
                    errorResult.SkippedFiles = bex.SkippedFiles;
                }

                if (bex.BlockedFiles != null && bex.BlockedFiles.Count > 0)
                {
                    errorResult.BlockedFiles = bex.BlockedFiles;
                }

                SendBackupCompletedHeartbeat(hostname, jobId, false);
                PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                WriteRunIndex(loggingContext, ParseSources(sources), backupTarget, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                return errorResult;
            }
            catch (Exception ex)
            {
                var errorResult = BackupResult.CreateError(
                    BackupErrorCodes.UNKNOWN_ERROR,
                    String.Format("Errore generale backup: {0}", ex.Message),
                    backupTarget
                );

                SendBackupCompletedHeartbeat(hostname, jobId, false);
                PopulateRunMetadata(errorResult, loggingContext, operations, bytesProcessed);
                WriteRunIndex(loggingContext, ParseSources(sources), backupTarget, false, operations, bytesProcessed, errorResult, _skippedFiles, errorResult.Errors);
                return errorResult;
            }
            finally
            {
                CleanupOldRunLogs(loggingContext, logRetentionDays, runIndexRetentionDays);
                CleanupConnection();
                _skippedFiles.Clear();
                _totalFiles = 0;
                _copiedFiles = 0;
                _skippedFilesCount = 0;
                _failedFiles = 0;
            }
        }

        private void PopulateRunMetadata(BackupResult result, RunLoggingContext context, List<RobocopyResult> operations, long bytesProcessed)
        {
            if (result == null)
                return;

            var lastOp = (operations != null && operations.Count > 0) ? operations[operations.Count - 1] : null;

            result.LogPath = context != null ? context.LogFilePath : result.LogPath;
            result.RunLogIndexPath = context != null ? context.RunIndexPath : result.RunLogIndexPath;
            result.CommandUsed = lastOp != null ? lastOp.CommandLine : result.CommandUsed;
            result.ExitCode = lastOp != null ? (int?)lastOp.ExitCode : result.ExitCode;
            result.StartTimestamp = context != null ? context.StartedAtUtc.ToString("o") : result.StartTimestamp;
            result.EndTimestamp = DateTime.UtcNow.ToString("o");

            if (result.BytesProcessed == 0 && bytesProcessed > 0)
            {
                result.BytesProcessed = bytesProcessed;
            }
        }

        private void SendBackupCompletedHeartbeat(string hostname, string jobId, bool success)
        {
            if (_serverComm != null && !String.IsNullOrEmpty(jobId))
            {
                try
                {
                    string status = success ? "completed" : "failed";
                    _serverComm.SendHeartbeat(hostname, status, jobId);
                }
                catch { }
            }
        }

        private int ExtractRetentionDays(IDictionary<string, object> options, string key, int defaultValue)
        {
            if (options == null || !options.ContainsKey(key) || options[key] == null)
                return defaultValue;

            int parsed;
            if (Int32.TryParse(options[key].ToString(), out parsed) && parsed > 0)
                return parsed;

            return defaultValue;
        }

        private void CleanupOldRunLogs(RunLoggingContext context, int logRetentionDays, int indexRetentionDays)
        {
            try
            {
                if (context == null)
                    return;

                string jobDir = context.JobDirectoryPath;
                if (String.IsNullOrWhiteSpace(jobDir) || !Directory.Exists(jobDir))
                    return;

                DateTime logCutoff = DateTime.UtcNow.AddDays(-logRetentionDays);
                DateTime indexCutoff = DateTime.UtcNow.AddDays(-indexRetentionDays);

                foreach (var file in Directory.GetFiles(jobDir, "*.log"))
                {
                    try
                    {
                        var info = new FileInfo(file);
                        if (info.LastWriteTimeUtc < logCutoff && !String.Equals(file, context.LogFilePath, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Delete(file);
                        }
                    }
                    catch { }
                }

                foreach (var file in Directory.GetFiles(jobDir, "*.run.json"))
                {
                    try
                    {
                        var info = new FileInfo(file);
                        if (info.LastWriteTimeUtc < indexCutoff && !String.Equals(file, context.RunIndexPath, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Delete(file);
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        public void SetLogger(Action<string> logger)
        {
            if (_shareManager != null)
            {
                _shareManager.Logger = logger;
            }
        }

        private List<string> ParseSources(object sources)
        {
            var sourceList = new List<string>();

            if (sources is object[])
            {
                foreach (var source in (object[])sources)
                {
                    sourceList.Add(source.ToString());
                }
            }
            else if (sources is string)
            {
                sourceList.Add((string)sources);
            }

            return sourceList;
        }

        private ValidationResult ValidateUncPath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return ValidationResult.Fail(
                    BackupErrorCodes.UNC_INVALID_FORMAT,
                    "Percorso di destinazione vuoto"
                );
            }

            if (!path.StartsWith(@"\\"))
            {
                return ValidationResult.Ok();
            }

            var parts = path.TrimStart('\\').Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                return ValidationResult.Fail(
                    BackupErrorCodes.UNC_INVALID_FORMAT,
                    "Percorso UNC non valido: deve essere nel formato \\\\server\\share"
                );
            }

            return ValidationResult.Ok();
        }

        private BackupResult EnsureDestinationAccessible(string destination, IDictionary<string, object> options)
        {
            string normalizedDest = FileSystemOperations.NormalizePath(destination);

            if (!normalizedDest.StartsWith(@"\\"))
            {
                try
                {
                    string longDest = FileSystemOperations.NormalizeLongPath(normalizedDest);
                    if (!Directory.Exists(longDest))
                    {
                        Directory.CreateDirectory(longDest);
                    }
                    return new BackupResult { Success = true };
                }
                catch (PathTooLongException ex)
                {
                    return BackupResult.CreateError(
                        BackupErrorCodes.PATH_TOO_LONG,
                        String.Format("Percorso troppo lungo: {0}. {1}", destination, ex.Message),
                        destination,
                        206
                    );
                }
                catch (Exception ex)
                {
                    return BackupResult.CreateError(
                        BackupErrorCodes.DESTINATION_WRITE_ERROR,
                        String.Format("Impossibile creare directory locale: {0}", ex.Message),
                        destination
                    );
                }
            }

            NetworkCredentials credentials = null;
            if (options != null && options.ContainsKey("credentials"))
            {
                var credsDict = options["credentials"] as IDictionary<string, object>;
                credentials = NetworkCredentials.FromDictionary(credsDict);
            }

            if (_shareManager == null)
            {
                _shareManager = new NetworkShareManager
                {
                    AllowCurrentUserFallback = true,
                    AllowGuestFallback = true,
                    MaxRetries = 3
                };
            }

            var connectionResult = _shareManager.Connect(normalizedDest, credentials);

            if (!connectionResult.Success)
            {
                return connectionResult.ToBackupResult();
            }

            try
            {
                string longDest = FileSystemOperations.NormalizeLongPath(normalizedDest);
                if (!Directory.Exists(longDest))
                {
                    Directory.CreateDirectory(longDest);
                }
                return new BackupResult { Success = true };
            }
            catch (PathTooLongException ex)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.PATH_TOO_LONG,
                    String.Format("Percorso troppo lungo: {0}. {1}", destination, ex.Message),
                    destination,
                    206
                );
            }
            catch (UnauthorizedAccessException)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.ACCESS_DENIED,
                    String.Format("Accesso negato alla creazione di {0}. Verificare i permessi sulla share.", destination),
                    destination
                );
            }
            catch (Exception ex)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.DESTINATION_WRITE_ERROR,
                    String.Format("Errore creazione directory: {0}", ex.Message),
                    destination
                );
            }
        }

        private BackupResult TestWriteAccess(string destination)
        {
            string normalizedDest = FileSystemOperations.NormalizePath(destination);
            string longDest = FileSystemOperations.NormalizeLongPath(normalizedDest);
            string testFile = Path.Combine(longDest, String.Format(".write_test_{0}", Guid.NewGuid().ToString("N")));
            try
            {
                File.WriteAllText(testFile, "test");
                File.Delete(testFile);
                return new BackupResult { Success = true };
            }
            catch (PathTooLongException ex)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.PATH_TOO_LONG,
                    String.Format("Percorso troppo lungo: {0}. {1}", destination, ex.Message),
                    destination,
                    206
                );
            }
            catch (UnauthorizedAccessException)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.ACCESS_DENIED,
                    String.Format("Permessi di scrittura insufficienti su {0}", destination),
                    destination
                );
            }
            catch (Exception ex)
            {
                return BackupResult.CreateError(
                    BackupErrorCodes.DESTINATION_WRITE_ERROR,
                    String.Format("Test scrittura fallito: {0}", ex.Message),
                    destination
                );
            }
        }

        private void CleanupConnection()
        {
            if (_shareManager != null)
            {
                try
                {
                    _shareManager.DisconnectAll();
                }
                catch { }
                _shareManager = null;
            }
        }

        private long ProcessSource(string source, string destination, RunLoggingContext loggingContext, bool appendLog, out RobocopyResult robocopyResult, bool mirrorMode, string logPayload, int logMaxBytes)
        {
            robocopyResult = null;
            string normalizedSource = FileSystemOperations.NormalizePath(source);
            string normalizedDest = FileSystemOperations.NormalizePath(destination);

            if (FileSystemOperations.PathsAreEqual(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.SOURCE_EQUALS_DESTINATION,
                    String.Format("Sorgente e destinazione sono identiche: {0}", source),
                    source
                );
            }

            if (FileSystemOperations.PathsOverlap(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.PATH_OVERLAP,
                    String.Format("Sorgente e destinazione si sovrappongono: {0} -> {1}", source, destination),
                    source
                );
            }

            if (!File.Exists(normalizedSource) && !Directory.Exists(normalizedSource))
            {
                throw new BackupException(
                    BackupErrorCodes.SOURCE_NOT_FOUND,
                    String.Format("Sorgente non trovata: {0}", source),
                    source
                );
            }

            var robocopy = new RobocopyEngine();
            bool isFile = File.Exists(normalizedSource);
            bool includeLogContent = !String.Equals(logPayload, "none", StringComparison.OrdinalIgnoreCase);
            int effectiveLogBytes = String.Equals(logPayload, "full", StringComparison.OrdinalIgnoreCase) ? 0 : logMaxBytes;

            robocopyResult = robocopy.Copy(
                normalizedSource,
                normalizedDest,
                isFile,
                loggingContext != null ? loggingContext.LogFilePath : null,
                appendLog,
                true,
                mirrorMode,
                includeLogContent,
                effectiveLogBytes
            );

            if (robocopyResult.HasWarnings || robocopyResult.FailedFiles > 0)
            {
                if (!String.IsNullOrEmpty(robocopyResult.WarningMessage))
                {
                    _skippedFiles.Add(robocopyResult.WarningMessage);
                }
                if (robocopyResult.FailedFiles > 0)
                {
                    _skippedFiles.Add(String.Format("{0} file non copiati da {1}", robocopyResult.FailedFiles, source));
                }

                if (robocopyResult.BlockedFiles != null && robocopyResult.BlockedFiles.Count > 0)
                {
                    _skippedFiles.AddRange(robocopyResult.BlockedFiles);
                }
            }

            if (!robocopyResult.Success)
            {
                var stats = BackupStats.FromRobocopy(robocopyResult);
                var backupResult = robocopyResult.ToBackupResult();

                if (backupResult.Stats == null)
                {
                    backupResult.Stats = stats;
                }

                if ((backupResult.SkippedFiles == null || backupResult.SkippedFiles.Count == 0) && _skippedFiles.Count > 0)
                {
                    backupResult.SkippedFiles = new List<string>(_skippedFiles);
                }

                if (backupResult.BlockedFiles == null && robocopyResult.BlockedFiles != null)
                {
                    backupResult.BlockedFiles = new List<string>(robocopyResult.BlockedFiles);
                }

                throw new BackupException(
                    backupResult.ErrorCode,
                    backupResult.ErrorMessage,
                    source,
                    backupResult.WindowsErrorCode,
                    backupResult.Stats,
                    backupResult.SkippedFiles,
                    backupResult.BlockedFiles,
                    robocopyResult.BytesCopied
                );
            }

            _totalFiles += robocopyResult.TotalFiles;
            _copiedFiles += robocopyResult.CopiedFiles;
            _skippedFilesCount += robocopyResult.SkippedFiles;
            _failedFiles += robocopyResult.FailedFiles;

            return robocopyResult.BytesCopied;
        }

        private void GenerateBackupManifest(string destination, RunLoggingContext context, List<string> sources, long bytesProcessed, BackupStats stats, IDictionary<string, object> options)
        {
            try
            {
                string normalizedDest = FileSystemOperations.NormalizePath(destination);
                string manifestPath = Path.Combine(normalizedDest, "backup.manifest.json");

                var serializer = new JavaScriptSerializer();
                var manifest = new Dictionary<string, object>();

                manifest["version"] = "1.0";
                manifest["job_id"] = context != null ? context.JobId : null;
                manifest["client_id"] = context != null ? context.Hostname : Environment.MachineName;
                manifest["run_id"] = context != null ? context.RunId : null;
                manifest["run_timestamp"] = context != null ? context.RunTimestamp : DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
                manifest["timestamp"] = DateTime.UtcNow.ToString("o");
                manifest["sources"] = sources;
                manifest["destination"] = destination;
                manifest["bytes_processed"] = bytesProcessed;
                manifest["status"] = "success";

                if (stats != null)
                {
                    manifest["stats"] = new Dictionary<string, object>
                    {
                        { "total_files", stats.TotalFiles },
                        { "copied_files", stats.CopiedFiles },
                        { "skipped_files", stats.SkippedFilesCount },
                        { "failed_files", stats.FailedFiles }
                    };
                }

                File.WriteAllText(manifestPath, serializer.Serialize(manifest));
            }
            catch (Exception ex)
            {
                if (_serverComm != null)
                {
                    try
                    {
                        _serverComm.LogMessage(String.Format("Warning: Failed to generate manifest: {0}", ex.Message));
                    }
                    catch { }
                }
            }
        }

        private string BuildBackupTargetPath(string destinationRoot)
        {
            string timestampFolder = DateTime.Now.ToString("yyyy_MM_dd_HH_mm_ss");
            return Path.Combine(destinationRoot, timestampFolder);
        }

        private bool TryParseTimestampFromFolder(string folderName, out DateTime timestamp)
        {
            return DateTime.TryParseExact(
                folderName,
                "yyyy_MM_dd_HH_mm_ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out timestamp
            );
        }

        private List<Dictionary<string, object>> ApplyRetentionPolicy(string destinationRoot, int maxBackups, RunLoggingContext context)
        {
            var deletionEvents = new List<Dictionary<string, object>>();

            if (maxBackups <= 0)
            {
                return deletionEvents;
            }

            try
            {
                string normalizedRoot = FileSystemOperations.NormalizePath(destinationRoot);
                if (!Directory.Exists(normalizedRoot))
                {
                    return deletionEvents;
                }

                var backupDirs = new List<BackupDirectoryInfo>();
                foreach (var dir in Directory.GetDirectories(normalizedRoot))
                {
                    try
                    {
                        string name = Path.GetFileName(dir);
                        if (String.IsNullOrWhiteSpace(name))
                        {
                            continue;
                        }

                        DateTime parsedTimestamp;
                        if (!TryParseTimestampFromFolder(name, out parsedTimestamp))
                        {
                            continue;
                        }

                        var info = new DirectoryInfo(dir);
                        backupDirs.Add(new BackupDirectoryInfo
                        {
                            Path = dir,
                            CreationTime = parsedTimestamp,
                            LastWriteTime = info.LastWriteTime
                        });
                    }
                    catch { }
                }

                backupDirs.Sort((a, b) => b.CreationTime.CompareTo(a.CreationTime));

                if (backupDirs.Count <= maxBackups)
                {
                    return deletionEvents;
                }

                var robocopy = new RobocopyEngine();
                for (int i = maxBackups; i < backupDirs.Count; i++)
                {
                    var candidate = backupDirs[i];
                    try
                    {
                        var deleteResult = robocopy.DeleteDirectory(candidate.Path);
                        var deleteEvent = new Dictionary<string, object>();
                        deleteEvent["event_type"] = deleteResult.Success ? "DELETE_EXECUTED" : "DELETE_FAILED";
                        deleteEvent["timestamp"] = DateTime.UtcNow.ToString("o");
                        deleteEvent["path"] = candidate.Path;
                        deleteEvent["run_id"] = context != null ? context.RunId : null;
                        deleteEvent["job_id"] = context != null ? context.JobId : null;
                        deleteEvent["success"] = deleteResult.Success;
                        deleteEvent["reason"] = "retention_exceeded";

                        if (!deleteResult.Success)
                        {
                            deleteEvent["error"] = deleteResult.ErrorMessage;
                            if (_serverComm != null)
                            {
                                try
                                {
                                    _serverComm.LogMessage(String.Format("Warning: Retention delete failed for {0}: {1}", candidate.Path, deleteResult.ErrorMessage));
                                }
                                catch { }
                            }
                        }

                        deletionEvents.Add(deleteEvent);
                    }
                    catch (Exception ex)
                    {
                        var deleteEvent = new Dictionary<string, object>();
                        deleteEvent["event_type"] = "DELETE_FAILED";
                        deleteEvent["timestamp"] = DateTime.UtcNow.ToString("o");
                        deleteEvent["path"] = candidate.Path;
                        deleteEvent["run_id"] = context != null ? context.RunId : null;
                        deleteEvent["job_id"] = context != null ? context.JobId : null;
                        deleteEvent["error"] = ex.Message;
                        deleteEvent["reason"] = "retention_exceeded";
                        deletionEvents.Add(deleteEvent);
                    }
                }
            }
            catch (Exception ex)
            {
                if (_serverComm != null)
                {
                    try
                    {
                        _serverComm.LogMessage(String.Format("Warning: Retention policy failed: {0}", ex.Message));
                    }
                    catch { }
                }
            }

            return deletionEvents;
        }

        private int ExtractMaxBackups(IDictionary<string, object> options)
        {
            if (options == null)
                return 0;

            if (options.ContainsKey("retention") && options["retention"] != null)
            {
                var retention = options["retention"] as IDictionary<string, object>;
                if (retention != null && retention.ContainsKey("max_backups"))
                {
                    int parsed;
                    if (Int32.TryParse(retention["max_backups"].ToString(), out parsed))
                    {
                        return parsed;
                    }
                }
            }

            if (options.ContainsKey("max_backups"))
            {
                int parsed;
                if (Int32.TryParse(options["max_backups"].ToString(), out parsed))
                {
                    return parsed;
                }
            }

            return 0;
        }

        private void SaveRetentionEvents(RunLoggingContext context, List<Dictionary<string, object>> events)
        {
            try
            {
                if (context == null || String.IsNullOrWhiteSpace(context.JobDirectoryPath))
                    return;

                string eventsPath = Path.Combine(context.JobDirectoryPath, String.Format("{0}.retention.json", context.RunTimestamp));
                var serializer = new JavaScriptSerializer();

                var wrapper = new Dictionary<string, object>();
                wrapper["run_id"] = context.RunId;
                wrapper["job_id"] = context.JobId;
                wrapper["timestamp"] = DateTime.UtcNow.ToString("o");
                wrapper["events"] = events;

                File.WriteAllText(eventsPath, serializer.Serialize(wrapper));
            }
            catch { }
        }

        private class BackupDirectoryInfo
        {
            public string Path { get; set; }
            public DateTime CreationTime { get; set; }
            public DateTime LastWriteTime { get; set; }
        }
    }
}
