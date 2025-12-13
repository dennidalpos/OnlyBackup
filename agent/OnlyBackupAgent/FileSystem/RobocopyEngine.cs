using System;
using System.Diagnostics;
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

        public RobocopyResult Copy(string source, string destination, bool isFile = false)
        {
            try
            {
                string sourceDir;
                string filePattern = "*.*";
                string destDir = destination;

                if (isFile)
                {
                    FileInfo fileInfo = new FileInfo(source);
                    sourceDir = fileInfo.DirectoryName;
                    filePattern = fileInfo.Name;

                    Log("Copia file: {0} -> {1}", source, destination);
                }
                else
                {
                    DirectoryInfo dirInfo = new DirectoryInfo(source);
                    sourceDir = dirInfo.FullName;
                    destDir = Path.Combine(destination, dirInfo.Name);

                    Log("Copia directory: {0} -> {1}", source, destDir);
                }

                var args = BuildRobocopyArguments(sourceDir, destDir, filePattern, isFile);

                Log("Comando: robocopy {0}", args);

                var result = ExecuteRobocopy(args);

                return ParseResult(result, source, destDir);
            }
            catch (Exception ex)
            {
                return new RobocopyResult
                {
                    Success = false,
                    ErrorMessage = String.Format("Errore durante l'esecuzione di robocopy: {0}", ex.Message),
                    SourcePath = source,
                    DestinationPath = destination,
                    ExitCode = -1
                };
            }
        }

        private string BuildRobocopyArguments(string sourceDir, string destDir, string filePattern, bool isFile)
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
                args.Append(" /E");
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

            return args.ToString();
        }

        private ProcessResult ExecuteRobocopy(string arguments)
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

        private void ParseStatistics(string output, RobocopyResult result)
        {
            if (String.IsNullOrEmpty(output))
                return;

            var filesMatch = Regex.Match(output, @"Files\s*:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)");
            if (filesMatch.Success)
            {
                result.TotalFiles = int.Parse(filesMatch.Groups[1].Value);
                result.CopiedFiles = int.Parse(filesMatch.Groups[2].Value);
                result.SkippedFiles = int.Parse(filesMatch.Groups[3].Value);
                result.FailedFiles = int.Parse(filesMatch.Groups[5].Value);
            }

            var bytesMatch = Regex.Match(output, @"Bytes\s*:\s*(\d+)\s+(\d+)");
            if (bytesMatch.Success)
            {
                result.BytesCopied = long.Parse(bytesMatch.Groups[2].Value);
            }
            else
            {
                var bytesMatchAlt = Regex.Match(output, @"Bytes\s*:\s*(\d+(?:\.\d+)?)\s*([kmgt])?");
                if (bytesMatchAlt.Success)
                {
                    double bytes = double.Parse(bytesMatchAlt.Groups[1].Value);
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

        public int TotalFiles { get; set; }
        public int CopiedFiles { get; set; }
        public int SkippedFiles { get; set; }
        public int FailedFiles { get; set; }
        public long BytesCopied { get; set; }

        public BackupResult ToBackupResult()
        {
            if (Success)
            {
                var result = BackupResult.CreateSuccess(BytesCopied);

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

            return BackupResult.CreateError(
                errorCode,
                ErrorMessage ?? "Errore sconosciuto durante la copia",
                SourcePath
            );
        }
    }

    internal class ProcessResult
    {
        public int ExitCode { get; set; }
        public string Output { get; set; }
        public string Errors { get; set; }
    }
}
