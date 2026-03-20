using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace OnlyBackupAgent.FileSystem
{
    internal class BackupRunLogger
    {
        public BackupRunLoggingContext PrepareRunLogging(string hostname, string jobId, IDictionary<string, object> options)
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

            return new BackupRunLoggingContext
            {
                Hostname = hostname,
                JobId = sanitizedJobId,
                RunId = runId,
                RunTimestamp = runTimestamp,
                LogFilePath = Path.Combine(jobDir, String.Format("{0}.log", fileBase)),
                RunIndexPath = Path.Combine(jobDir, String.Format("{0}.run.json", fileBase)),
                JobDirectoryPath = jobDir,
                StartedAtUtc = DateTime.UtcNow
            };
        }

        public string SanitizePathSegment(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return null;

            foreach (var invalid in Path.GetInvalidFileNameChars())
            {
                value = value.Replace(invalid, '_');
            }

            return value.Trim();
        }

        public void WriteRunIndex(
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

        public void PopulateRunMetadata(BackupResult result, BackupRunLoggingContext context, List<RobocopyResult> operations, long bytesProcessed)
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

        public void CleanupOldRunLogs(BackupRunLoggingContext context, int logRetentionDays, int indexRetentionDays)
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
    }
}
