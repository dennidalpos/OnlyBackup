using System;
using System.Collections.Generic;
using System.IO;
using OnlyBackupAgent.Communication;

namespace OnlyBackupAgent.FileSystem
{
    public class BackupEngine
    {
        private NetworkShareManager _shareManager = null;
        private ServerCommunication _serverComm = null;
        private List<string> _skippedFiles = new List<string>();
        private readonly BackupRunLogger _runLogger;
        private readonly BackupRetentionManager _retentionManager;

        private int _totalFiles = 0;
        private int _copiedFiles = 0;
        private int _skippedFilesCount = 0;
        private int _failedFiles = 0;

        public BackupEngine(ServerCommunication serverComm = null)
        {
            _serverComm = serverComm;
            _runLogger = new BackupRunLogger();
            _retentionManager = new BackupRetentionManager(LogServerWarning);
        }

        private BackupRunLoggingContext PrepareRunLogging(string hostname, string jobId, IDictionary<string, object> options)
        {
            return _runLogger.PrepareRunLogging(hostname, jobId, options);
        }

        private string SanitizePathSegment(string value)
        {
            return _runLogger.SanitizePathSegment(value);
        }

        private void WriteRunIndex(
            BackupRunLoggingContext context,
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
            _runLogger.WriteRunIndex(context, sources, destination, success, operations, bytesProcessed, finalResult, warnings, errors);
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

        private void PopulateRunMetadata(BackupResult result, BackupRunLoggingContext context, List<RobocopyResult> operations, long bytesProcessed)
        {
            _runLogger.PopulateRunMetadata(result, context, operations, bytesProcessed);
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

        private void CleanupOldRunLogs(BackupRunLoggingContext context, int logRetentionDays, int indexRetentionDays)
        {
            _runLogger.CleanupOldRunLogs(context, logRetentionDays, indexRetentionDays);
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

        private long ProcessSource(string source, string destination, BackupRunLoggingContext loggingContext, bool appendLog, out RobocopyResult robocopyResult, bool mirrorMode, string logPayload, int logMaxBytes)
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

        private void GenerateBackupManifest(string destination, BackupRunLoggingContext context, List<string> sources, long bytesProcessed, BackupStats stats, IDictionary<string, object> options)
        {
            _retentionManager.GenerateBackupManifest(destination, context, sources, bytesProcessed, stats);
        }

        private string BuildBackupTargetPath(string destinationRoot)
        {
            return _retentionManager.BuildBackupTargetPath(destinationRoot);
        }

        private bool TryParseTimestampFromFolder(string folderName, out DateTime timestamp)
        {
            return _retentionManager.TryParseTimestampFromFolder(folderName, out timestamp);
        }

        private List<Dictionary<string, object>> ApplyRetentionPolicy(string destinationRoot, int maxBackups, BackupRunLoggingContext context)
        {
            return _retentionManager.ApplyRetentionPolicy(destinationRoot, maxBackups, context);
        }

        private int ExtractMaxBackups(IDictionary<string, object> options)
        {
            return _retentionManager.ExtractMaxBackups(options);
        }

        private void SaveRetentionEvents(BackupRunLoggingContext context, List<Dictionary<string, object>> events)
        {
            _retentionManager.SaveRetentionEvents(context, events);
        }

        private void LogServerWarning(string message)
        {
            if (_serverComm == null || String.IsNullOrWhiteSpace(message))
                return;

            try
            {
                _serverComm.LogMessage(message);
            }
            catch { }
        }
    }
}
