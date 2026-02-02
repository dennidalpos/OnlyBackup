using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace OnlyBackupAgent.FileSystem
{
    public class RobocopyEngine
    {
        private Action<string> _logger;

        public RobocopyEngine(Action<string> logger = null)
        {
            _logger = logger;
        }

        public RobocopyResult Copy(string source, string destination, bool isFile = false, string logFilePath = null, bool appendLog = false, bool teeOutput = true, bool mirrorMode = false, bool includeLogContent = true, int logTailBytes = 524288)
        {
            try
            {
                if (!String.IsNullOrWhiteSpace(logFilePath))
                {
                    try
                    {
                        string dir = Path.GetDirectoryName(logFilePath);
                        if (!String.IsNullOrWhiteSpace(dir) && !Directory.Exists(dir))
                        {
                            Directory.CreateDirectory(dir);
                        }
                    }
                    catch { }
                }

                string sourceDir;
                string filePattern = "*.*";
                string destDir = destination;

                string normalizedSource = FileSystemOperations.NormalizePath(source);
                string normalizedDestination = FileSystemOperations.NormalizePath(destination);

                string longSource = FileSystemOperations.NormalizeLongPath(normalizedSource);
                string longDestination = FileSystemOperations.NormalizeLongPath(normalizedDestination);

                if (isFile)
                {
                    FileInfo fileInfo = new FileInfo(longSource);
                    sourceDir = fileInfo.DirectoryName;
                    filePattern = fileInfo.Name;

                    Log("Copia file: {0} -> {1}", normalizedSource, normalizedDestination);
                }
                else
                {
                    DirectoryInfo dirInfo = new DirectoryInfo(longSource);
                    sourceDir = dirInfo.FullName;
                    destDir = Path.Combine(longDestination, dirInfo.Name);

                    Log("Copia directory: {0} -> {1}", normalizedSource, FileSystemOperations.NormalizePath(destDir));
                }

                var args = BuildRobocopyArguments(sourceDir, destDir, filePattern, isFile, logFilePath, appendLog, teeOutput, mirrorMode);

                Log("Comando: robocopy {0}", args);

                var startUtc = DateTime.UtcNow;
                var result = ExecuteRobocopy(args, logFilePath);

                var parsed = ParseResult(result, source, destDir);
                parsed.CommandLine = String.Format("robocopy.exe {0}", args);
                parsed.LogFilePath = logFilePath;
                parsed.LogContent = includeLogContent ? ReadLogFile(logFilePath, logTailBytes) : null;
                parsed.StartedAtUtc = startUtc;
                parsed.EndedAtUtc = DateTime.UtcNow;

                return parsed;
            }
            catch (Exception ex)
            {
                return new RobocopyResult
                {
                    Success = false,
                    ErrorMessage = String.Format("Errore durante l'esecuzione di robocopy: {0}", ex.Message),
                    SourcePath = source,
                    DestinationPath = destination,
                    ExitCode = -1,
                    LogFilePath = logFilePath,
                    StartedAtUtc = DateTime.UtcNow,
                    EndedAtUtc = DateTime.UtcNow
                };
            }
        }

        public RobocopyResult DeleteDirectory(string target)
        {
            if (String.IsNullOrWhiteSpace(target))
            {
                return new RobocopyResult
                {
                    Success = false,
                    ErrorMessage = "Percorso di destinazione mancante",
                    DestinationPath = target,
                    ExitCode = -1
                };
            }

            string normalizedTarget = FileSystemOperations.NormalizePath(target);
            string longTarget = FileSystemOperations.NormalizeLongPath(normalizedTarget);

            try
            {
                if (!Directory.Exists(longTarget))
                {
                    return new RobocopyResult
                    {
                        Success = true,
                        HasWarnings = true,
                        WarningMessage = "Percorso già inesistente",
                        DestinationPath = normalizedTarget,
                        ExitCode = 0
                    };
                }

                string tempEmpty = Path.Combine(Path.GetTempPath(), "ob_empty_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tempEmpty);

                Log("Eliminazione directory via robocopy: {0}", longTarget);

                var args = new StringBuilder();
                args.AppendFormat("\"{0}\" \"{1}\"", tempEmpty, longTarget);
                args.Append(" /MIR /R:1 /W:1 /NP /NFL /NDL /NJH /NJS /BYTES /MT:8 /256");

                var result = ExecuteRobocopy(args.ToString(), null);

                try
                {
                    Directory.Delete(tempEmpty, true);
                }
                catch { }

                var parsed = ParseResult(result, tempEmpty, longTarget);

                if (parsed.Success)
                {
                    try
                    {
                        Directory.Delete(longTarget, true);
                    }
                    catch (Exception ex)
                    {
                        parsed.HasWarnings = true;
                        parsed.WarningMessage = String.Format("Contenuto cancellato ma impossibile rimuovere la cartella: {0}", ex.Message);
                    }
                }

                return parsed;
            }
            catch (Exception ex)
            {
                return new RobocopyResult
                {
                    Success = false,
                    ErrorMessage = String.Format("Errore durante l'eliminazione: {0}", ex.Message),
                    DestinationPath = normalizedTarget,
                    ExitCode = -1
                };
            }
        }

        private string BuildRobocopyArguments(string sourceDir, string destDir, string filePattern, bool isFile, string logFilePath, bool appendLog, bool teeOutput, bool mirrorMode)
        {
            var args = new StringBuilder();

            args.AppendFormat("\"{0}\" \"{1}\"", sourceDir, destDir);

            if (!String.IsNullOrEmpty(filePattern) && filePattern != "*.*")
            {
                args.AppendFormat(" \"{0}\"", filePattern);
            }

            if (isFile)
            {
                args.Append(" /COPY:DAT");
                args.Append(" /R:3");
                args.Append(" /W:1");
                args.Append(" /NP");
                args.Append(" /NFL");
                args.Append(" /NDL");
            }
            else
            {
                if (mirrorMode)
                {
                    args.Append(" /MIR");
                }
                else
                {
                    args.Append(" /E");
                }
                args.Append(" /COPY:DAT");
                args.Append(" /DCOPY:T");
                args.Append(" /R:3");
                args.Append(" /W:1");
                args.Append(" /NP");
                args.Append(" /NFL");
                args.Append(" /NDL");
            }

            args.Append(" /256");
            args.Append(" /MT:8");
            args.Append(" /BYTES");

            if (!String.IsNullOrWhiteSpace(logFilePath))
            {
                args.AppendFormat(" /LOG{0}:\"{1}\"", appendLog ? "+" : string.Empty, logFilePath);
                if (teeOutput)
                {
                    args.Append(" /TEE");
                }
            }

            return args.ToString();
        }

        private ProcessResult ExecuteRobocopy(string arguments, string logFilePath)
        {
            var processInfo = new ProcessStartInfo
            {
                FileName = "robocopy.exe",
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.GetEncoding(850)
            };

            var output = new StringBuilder();
            var errors = new StringBuilder();

            using (var process = new Process { StartInfo = processInfo })
            {
                process.OutputDataReceived += (sender, e) =>
                {
                    if (!String.IsNullOrEmpty(e.Data))
                    {
                        output.AppendLine(e.Data);
                    }
                };

                process.ErrorDataReceived += (sender, e) =>
                {
                    if (!String.IsNullOrEmpty(e.Data))
                    {
                        errors.AppendLine(e.Data);
                    }
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (!process.WaitForExit(3600000))
                {
                    try
                    {
                        process.Kill();
                        throw new TimeoutException("Robocopy timeout dopo 1 ora");
                    }
                    catch { }
                }

                return new ProcessResult
                {
                    ExitCode = process.ExitCode,
                    Output = output.ToString(),
                    Errors = errors.ToString()
                };
            }
        }

        private string ReadLogFile(string logFilePath, int maxBytes = 524288)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(logFilePath) || !File.Exists(logFilePath))
                {
                    return null;
                }

                var info = new FileInfo(logFilePath);
                long length = info.Length;
                if (maxBytes <= 0)
                {
                    return File.ReadAllText(logFilePath, Encoding.UTF8);
                }

                int toRead = (int)Math.Min(length, maxBytes);

                using (var stream = new FileStream(logFilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (length > maxBytes)
                    {
                        stream.Seek(length - toRead, SeekOrigin.Begin);
                    }

                    byte[] buffer = new byte[toRead];
                    int read = stream.Read(buffer, 0, toRead);
                    return Encoding.UTF8.GetString(buffer, 0, read);
                }
            }
            catch
            {
                return null;
            }
        }

        private RobocopyResult ParseResult(ProcessResult processResult, string source, string destination)
        {
            int exitCode = processResult.ExitCode;

            var result = new RobocopyResult
            {
                ExitCode = exitCode,
                SourcePath = source,
                DestinationPath = destination,
                Output = processResult.Output
            };

            ParseStatistics(processResult.Output, result);
            ParseBlockedFiles(processResult.Output, result);

            if (exitCode < 8)
            {
                result.Success = true;
                result.ErrorMessage = null;

                if (exitCode >= 4)
                {
                    result.HasWarnings = true;
                    result.WarningMessage = GetWarningMessage(exitCode);
                }
            }
            else
            {
                result.Success = false;
                result.ErrorMessage = GetErrorMessage(exitCode, processResult.Output);
            }

            return result;
        }

        private long ParseLongSafe(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return 0;

            var normalized = value.Trim();

            normalized = normalized.Replace(".", string.Empty);
            normalized = normalized.Replace(",", string.Empty);

            long parsedInteger;
            if (long.TryParse(normalized, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedInteger))
            {
                return parsedInteger;
            }

            double parsedDouble;
            if (double.TryParse(value.Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out parsedDouble))
            {
                return (long)parsedDouble;
            }

            return 0;
        }

        private int ParseIntSafe(string value)
        {
            var parsed = ParseLongSafe(value);
            if (parsed > int.MaxValue)
            {
                return int.MaxValue;
            }
            return (int)parsed;
        }

        private void ParseStatistics(string output, RobocopyResult result)
        {
            if (String.IsNullOrEmpty(output))
                return;

            var filesMatch = Regex.Match(
                output,
                @"^(?:\s*(?:Files?|File)\s*:)\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)",
                RegexOptions.IgnoreCase | RegexOptions.Multiline
            );
            if (filesMatch.Success)
            {
                result.TotalFiles = ParseIntSafe(filesMatch.Groups[1].Value);
                result.CopiedFiles = ParseIntSafe(filesMatch.Groups[2].Value);
                result.SkippedFiles = ParseIntSafe(filesMatch.Groups[3].Value);
                result.FailedFiles = ParseIntSafe(filesMatch.Groups[5].Value);
            }

            var bytesMatch = Regex.Match(
                output,
                @"^(?:\s*(?:Bytes?|Byte)\s*:)\s*([\d\.,]+)\s+([\d\.,]+)",
                RegexOptions.IgnoreCase | RegexOptions.Multiline
            );
            if (bytesMatch.Success)
            {
                result.BytesCopied = ParseLongSafe(bytesMatch.Groups[2].Value);
            }
            else
            {
                var bytesMatchAlt = Regex.Match(
                    output,
                    @"(?:Bytes?|Byte)\s*:\s*([\d\.,]+)\s*([kmgt])?",
                    RegexOptions.IgnoreCase
                );
                if (bytesMatchAlt.Success)
                {
                    double bytes = ParseLongSafe(bytesMatchAlt.Groups[1].Value);
                    string unit = bytesMatchAlt.Groups[2].Value.ToLower();

                    switch (unit)
                    {
                        case "k": bytes *= 1024; break;
                        case "m": bytes *= 1024 * 1024; break;
                        case "g": bytes *= 1024 * 1024 * 1024; break;
                        case "t": bytes *= 1024L * 1024 * 1024 * 1024; break;
                    }

                    result.BytesCopied = (long)bytes;
                }
            }
        }

        private void ParseBlockedFiles(string output, RobocopyResult result)
        {
            if (String.IsNullOrWhiteSpace(output))
                return;

            var blocked = new List<string>();
            var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();

                var copyMatch = Regex.Match(
                    line,
                    @"ERROR\s+\d+\s*\(0x[0-9A-Fa-f]+\)\s+(?:Copying\s+(?:File|Directory)|Accessing\s+Source)\s+(.+?)\s+->",
                    RegexOptions.IgnoreCase
                );

                if (copyMatch.Success)
                {
                    blocked.Add(copyMatch.Groups[1].Value.Trim());
                    continue;
                }

                var destMatch = Regex.Match(
                    line,
                    @"ERROR\s+\d+\s*\(0x[0-9A-Fa-f]+\)\s+Accessing\s+Destination\s+(.+)",
                    RegexOptions.IgnoreCase
                );

                if (destMatch.Success)
                {
                    blocked.Add(destMatch.Groups[1].Value.Trim());
                }
            }

            result.BlockedFiles = blocked;
        }

        private string GetWarningMessage(int exitCode)
        {
            switch (exitCode)
            {
                case 4:
                    return "Alcuni file o directory non corrispondono (mismatched)";
                case 5:
                    return "Alcuni file copiati, altri con differenze rilevate";
                case 6:
                    return "File aggiuntivi e differenze rilevate";
                case 7:
                    return "File copiati con alcune differenze e file aggiuntivi";
                default:
                    return "Operazione completata con avvisi (exit code: " + exitCode + ")";
            }
        }

        private string GetErrorMessage(int exitCode, string output)
        {
            string baseMessage;

            switch (exitCode)
            {
                case 8:
                    baseMessage = "Alcuni file o directory non possono essere copiati (accesso negato, file bloccati, o percorso non trovato)";
                    break;
                case 16:
                    baseMessage = "Errore grave: nessun file copiato. Verificare percorsi e permessi";
                    break;
                default:
                    baseMessage = String.Format("Robocopy fallito con exit code {0}", exitCode);
                    break;
            }

            if (!String.IsNullOrEmpty(output))
            {
                if (output.Contains("ERROR 5"))
                {
                    baseMessage += ". Accesso negato - verificare i permessi";
                }
                else if (output.Contains("ERROR 2") || output.Contains("ERROR 3"))
                {
                    baseMessage += ". Percorso non trovato";
                }
                else if (output.Contains("ERROR 32"))
                {
                    baseMessage += ". File in uso da un altro processo";
                }
                else if (output.Contains("ERROR 64"))
                {
                    baseMessage += ". Nome di rete non trovato";
                }
                else if (output.Contains("ERROR 67"))
                {
                    baseMessage += ". Share di rete non trovata";
                }
            }

            return baseMessage;
        }

        private void Log(string format, params object[] args)
        {
            if (_logger != null)
            {
                try
                {
                    _logger(String.Format("[RobocopyEngine] " + format, args));
                }
                catch { }
            }
        }
    }

    public class RobocopyResult
    {
        public bool Success { get; set; }
        public int ExitCode { get; set; }
        public string ErrorMessage { get; set; }
        public string WarningMessage { get; set; }
        public bool HasWarnings { get; set; }
        public string SourcePath { get; set; }
        public string DestinationPath { get; set; }
        public string Output { get; set; }

        public string CommandLine { get; set; }
        public string LogFilePath { get; set; }
        public string LogContent { get; set; }
        public DateTime? StartedAtUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }

        public int TotalFiles { get; set; }
        public int CopiedFiles { get; set; }
        public int SkippedFiles { get; set; }
        public int FailedFiles { get; set; }
        public long BytesCopied { get; set; }
        public List<string> BlockedFiles { get; set; }

        public RobocopyResult()
        {
            BlockedFiles = new List<string>();
        }

        public BackupResult ToBackupResult()
        {
            var stats = BackupStats.FromRobocopy(this);

            if (Success)
            {
                var result = BackupResult.CreateSuccess(BytesCopied, stats);

                result.LogPath = LogFilePath;
                result.LogContent = LogContent;
                result.CommandUsed = CommandLine;
                result.ExitCode = ExitCode;
                result.StartTimestamp = StartedAtUtc.HasValue ? StartedAtUtc.Value.ToString("o") : null;
                result.EndTimestamp = EndedAtUtc.HasValue ? EndedAtUtc.Value.ToString("o") : null;

                if (BlockedFiles != null && BlockedFiles.Count > 0)
                {
                    result.BlockedFiles = new List<string>(BlockedFiles);
                    result.SkippedFiles = result.SkippedFiles ?? new System.Collections.Generic.List<string>();
                    result.SkippedFiles.AddRange(BlockedFiles);
                }

                if (HasWarnings && !String.IsNullOrEmpty(WarningMessage))
                {
                    result.SkippedFiles = result.SkippedFiles ?? new System.Collections.Generic.List<string>();
                    result.SkippedFiles.Add(WarningMessage);
                }

                if (FailedFiles > 0)
                {
                    result.SkippedFiles = result.SkippedFiles ?? new System.Collections.Generic.List<string>();
                    result.SkippedFiles.Add(String.Format("{0} file non copiati (vedi log)", FailedFiles));
                }

                return result;
            }

            string errorCode = BackupErrorCodes.DESTINATION_WRITE_ERROR;

            if (ErrorMessage != null)
            {
                if (ErrorMessage.Contains("Accesso negato") || ErrorMessage.Contains("permessi"))
                {
                    errorCode = BackupErrorCodes.ACCESS_DENIED;
                }
                else if (ErrorMessage.Contains("non trovato") || ErrorMessage.Contains("non trovata"))
                {
                    errorCode = BackupErrorCodes.SOURCE_NOT_FOUND;
                }
                else if (ErrorMessage.Contains("Share") || ErrorMessage.Contains("rete"))
                {
                    errorCode = BackupErrorCodes.NETWORK_PATH_NOT_FOUND;
                }
            }

            var errorResult = BackupResult.CreateError(
                errorCode,
                ErrorMessage ?? "Errore sconosciuto durante la copia",
                SourcePath
            );

            errorResult.Stats = stats;
            errorResult.LogPath = LogFilePath;
            errorResult.LogContent = LogContent;
            errorResult.CommandUsed = CommandLine;
            errorResult.ExitCode = ExitCode;
            errorResult.StartTimestamp = StartedAtUtc.HasValue ? StartedAtUtc.Value.ToString("o") : null;
            errorResult.EndTimestamp = EndedAtUtc.HasValue ? EndedAtUtc.Value.ToString("o") : null;

            if (BlockedFiles != null && BlockedFiles.Count > 0)
            {
                errorResult.BlockedFiles = new List<string>(BlockedFiles);
                errorResult.SkippedFiles = errorResult.SkippedFiles ?? new System.Collections.Generic.List<string>();
                errorResult.SkippedFiles.AddRange(BlockedFiles);
            }

            return errorResult;
        }
    }

    internal class ProcessResult
    {
        public int ExitCode { get; set; }
        public string Output { get; set; }
        public string Errors { get; set; }
    }
}
