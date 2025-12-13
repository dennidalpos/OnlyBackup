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

        private int _totalFiles = 0;
        private int _copiedFiles = 0;
        private int _skippedFilesCount = 0;
        private int _failedFiles = 0;

        public BackupEngine(ServerCommunication serverComm = null)
        {
            _serverComm = serverComm;
        }

        public BackupResult PerformBackup(object sources, string destination, object options, string jobId = null)
        {
            var errorsList = new List<string>();
            var optionsDict = options as IDictionary<string, object>;
            long bytesProcessed = 0;
            string hostname = Environment.MachineName;

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
                var uncValidation = ValidateUncPath(destination);
                if (!uncValidation.Valid)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    return BackupResult.CreateError(
                        uncValidation.ErrorCode,
                        uncValidation.ErrorMessage,
                        destination
                    );
                }

                var accessResult = EnsureDestinationAccessible(destination, optionsDict);
                if (!accessResult.Success)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    return accessResult;
                }

                var writeTest = TestWriteAccess(destination);
                if (!writeTest.Success)
                {
                    SendBackupCompletedHeartbeat(hostname, jobId, false);
                    return writeTest;
                }

                List<string> sourceList = ParseSources(sources);

                foreach (var source in sourceList)
                {
                    try
                    {
                        bytesProcessed += ProcessSource(source, destination);
                    }
                    catch (BackupException bex)
                    {
                        SendBackupCompletedHeartbeat(hostname, jobId, false);
                        return BackupResult.CreateError(
                            bex.ErrorCode,
                            bex.Message,
                            bex.AffectedPath,
                            bex.WindowsErrorCode
                        );
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

                SendBackupCompletedHeartbeat(hostname, jobId, false);
                return errorResult;
            }
            catch (Exception ex)
            {
                var errorResult = BackupResult.CreateError(
                    BackupErrorCodes.UNKNOWN_ERROR,
                    String.Format("Errore generale backup: {0}", ex.Message),
                    destination
                );

                SendBackupCompletedHeartbeat(hostname, jobId, false);
                return errorResult;
            }
            finally
            {
                CleanupConnection();
                _skippedFiles.Clear();
                _totalFiles = 0;
                _copiedFiles = 0;
                _skippedFilesCount = 0;
                _failedFiles = 0;
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

        private long ProcessSource(string source, string destination)
        {
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

            var robocopyResult = robocopy.Copy(normalizedSource, normalizedDest, isFile);

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
            }

            if (!robocopyResult.Success)
            {
                var backupResult = robocopyResult.ToBackupResult();
                throw new BackupException(
                    backupResult.ErrorCode,
                    backupResult.ErrorMessage,
                    source
                );
            }

            _totalFiles += robocopyResult.TotalFiles;
            _copiedFiles += robocopyResult.CopiedFiles;
            _skippedFilesCount += robocopyResult.SkippedFiles;
            _failedFiles += robocopyResult.FailedFiles;

            return robocopyResult.BytesCopied;
        }
    }
}
