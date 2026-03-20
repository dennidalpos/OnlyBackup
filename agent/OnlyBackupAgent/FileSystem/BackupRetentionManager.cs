using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Web.Script.Serialization;

namespace OnlyBackupAgent.FileSystem
{
    internal class BackupRetentionManager
    {
        private readonly Action<string> _warningLogger;

        private class BackupDirectoryInfo
        {
            public string Path { get; set; }
            public DateTime CreationTime { get; set; }
            public DateTime LastWriteTime { get; set; }
        }

        public BackupRetentionManager(Action<string> warningLogger)
        {
            _warningLogger = warningLogger;
        }

        public void GenerateBackupManifest(string destination, BackupRunLoggingContext context, List<string> sources, long bytesProcessed, BackupStats stats)
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
                LogWarning(String.Format("Warning: Failed to generate manifest: {0}", ex.Message));
            }
        }

        public string BuildBackupTargetPath(string destinationRoot)
        {
            return Path.Combine(destinationRoot, DateTime.Now.ToString("yyyy_MM_dd_HH_mm_ss"));
        }

        public bool TryParseTimestampFromFolder(string folderName, out DateTime timestamp)
        {
            return DateTime.TryParseExact(
                folderName,
                "yyyy_MM_dd_HH_mm_ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out timestamp
            );
        }

        public List<Dictionary<string, object>> ApplyRetentionPolicy(string destinationRoot, int maxBackups, BackupRunLoggingContext context)
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
                            LogWarning(String.Format("Warning: Retention delete failed for {0}: {1}", candidate.Path, deleteResult.ErrorMessage));
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
                LogWarning(String.Format("Warning: Retention policy failed: {0}", ex.Message));
            }

            return deletionEvents;
        }

        public int ExtractMaxBackups(IDictionary<string, object> options)
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

        public void SaveRetentionEvents(BackupRunLoggingContext context, List<Dictionary<string, object>> events)
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

        private void LogWarning(string message)
        {
            if (_warningLogger == null)
                return;

            try
            {
                _warningLogger(message);
            }
            catch { }
        }
    }
}
