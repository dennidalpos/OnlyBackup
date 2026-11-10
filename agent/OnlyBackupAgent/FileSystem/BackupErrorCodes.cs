using System;
using System.Collections.Generic;

namespace OnlyBackupAgent.FileSystem
{
    public static class BackupErrorCodes
    {
        public const string SUCCESS = "SUCCESS";

        public const string UNC_INVALID_FORMAT = "UNC_INVALID_FORMAT";
        public const string NETWORK_PATH_NOT_FOUND = "NETWORK_PATH_NOT_FOUND";
        public const string SHARE_NOT_FOUND = "SHARE_NOT_FOUND";
        public const string PATH_TOO_LONG = "PATH_TOO_LONG";

        public const string ACCESS_DENIED = "ACCESS_DENIED";
        public const string INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
        public const string CREDENTIAL_CONFLICT = "CREDENTIAL_CONFLICT";
        public const string GUEST_ACCESS_DISABLED = "GUEST_ACCESS_DISABLED";

        public const string NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE";
        public const string SERVER_OFFLINE = "SERVER_OFFLINE";
        public const string SMB_SERVICE_NOT_RUNNING = "SMB_SERVICE_NOT_RUNNING";
        public const string NETWORK_TIMEOUT = "NETWORK_TIMEOUT";

        public const string SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND";
        public const string DESTINATION_WRITE_ERROR = "DESTINATION_WRITE_ERROR";
        public const string SOURCE_EQUALS_DESTINATION = "SOURCE_EQUALS_DESTINATION";
        public const string PATH_OVERLAP = "PATH_OVERLAP";

        public const string UNKNOWN_ERROR = "UNKNOWN_ERROR";

        private static readonly Dictionary<int, string> WindowsErrorMap = new Dictionary<int, string>
        {
            { 5, ACCESS_DENIED },
            { 51, SERVER_OFFLINE },
            { 53, NETWORK_PATH_NOT_FOUND },
            { 54, NETWORK_TIMEOUT },
            { 59, NETWORK_UNREACHABLE },
            { 64, NETWORK_PATH_NOT_FOUND },
            { 67, NETWORK_PATH_NOT_FOUND },
            { 121, NETWORK_TIMEOUT },
            { 86, INVALID_CREDENTIALS },
            { 1219, CREDENTIAL_CONFLICT },
            { 1245, GUEST_ACCESS_DISABLED },
            { 1312, GUEST_ACCESS_DISABLED },
            { 1326, INVALID_CREDENTIALS },
            { 2202, INVALID_CREDENTIALS },
            { 1203, NETWORK_PATH_NOT_FOUND },
            { 1231, NETWORK_UNREACHABLE },
            { 206, PATH_TOO_LONG }
        };

        private static readonly Dictionary<int, string> WindowsErrorMessages = new Dictionary<int, string>
        {
            { 5, "Accesso negato" },
            { 51, "Il server non risponde o e' offline" },
            { 53, "Percorso di rete non trovato. Verificare che il server sia raggiungibile" },
            { 54, "Rete occupata. Riprovare piu' tardi" },
            { 59, "Errore di rete imprevisto" },
            { 64, "Connessione di rete interrotta" },
            { 67, "Share di rete non trovata. Verificare che il nome della share sia corretto" },
            { 121, "Timeout di connessione alla rete" },
            { 86, "Password non valida" },
            { 1219, "Conflitto credenziali: esiste gia' una connessione con credenziali diverse. Disconnettersi prima o riavviare il servizio" },
            { 1245, "Accesso guest disabilitato. Fornire credenziali valide o abilitare AllowInsecureGuestAuth" },
            { 1312, "Sessione di accesso non valida. Possibile problema con l'accesso guest" },
            { 1326, "Credenziali non valide. Verificare username e password" },
            { 2202, "Nome utente non valido o formato errato" },
            { 1203, "Percorso di rete non valido o rete non disponibile" },
            { 1231, "Rete non raggiungibile. Verificare connettivita' e firewall" },
            { 206, "Percorso troppo lungo (supera il limite di 260 caratteri)" }
        };

        public static string MapWindowsError(int errorCode)
        {
            if (WindowsErrorMap.ContainsKey(errorCode))
            {
                return WindowsErrorMap[errorCode];
            }
            return UNKNOWN_ERROR;
        }

        public static string GetWindowsErrorMessage(int errorCode)
        {
            if (WindowsErrorMessages.ContainsKey(errorCode))
            {
                return WindowsErrorMessages[errorCode];
            }
            return String.Format("Errore Windows {0}", errorCode);
        }
    }

    public class BackupResult
    {
        public bool Success { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public int? WindowsErrorCode { get; set; }
        public string AffectedPath { get; set; }
        public long BytesProcessed { get; set; }
        public string[] Errors { get; set; }
        public List<string> SkippedFiles { get; set; }
        public List<string> BlockedFiles { get; set; }

        public string LogPath { get; set; }
        public string RunLogIndexPath { get; set; }
        public string CommandUsed { get; set; }
        public int? ExitCode { get; set; }
        public string StartTimestamp { get; set; }
        public string EndTimestamp { get; set; }
        public string LogContent { get; set; }

        public BackupStats Stats { get; set; }

        public BackupResult()
        {
            Success = true;
            ErrorCode = BackupErrorCodes.SUCCESS;
            Errors = new string[0];
            SkippedFiles = new List<string>();
            BlockedFiles = new List<string>();
            Stats = new BackupStats();
        }

        public static BackupResult CreateError(string errorCode, string message, string affectedPath = null, int? windowsCode = null)
        {
            return new BackupResult
            {
                Success = false,
                ErrorCode = errorCode,
                ErrorMessage = message,
                AffectedPath = affectedPath,
                WindowsErrorCode = windowsCode,
                Errors = new[] { message }
            };
        }

        public static BackupResult CreateSuccess(long bytesProcessed, BackupStats stats = null)
        {
            return new BackupResult
            {
                Success = true,
                ErrorCode = BackupErrorCodes.SUCCESS,
                BytesProcessed = bytesProcessed,
                Stats = stats ?? new BackupStats()
            };
        }
    }

    public class BackupStats
    {
        public int TotalFiles { get; set; }
        public int CopiedFiles { get; set; }
        public int SkippedFilesCount { get; set; }
        public int FailedFiles { get; set; }

        public BackupStats()
        {
            TotalFiles = 0;
            CopiedFiles = 0;
            SkippedFilesCount = 0;
            FailedFiles = 0;
        }

        public static BackupStats FromRobocopy(RobocopyResult robocopyResult)
        {
            if (robocopyResult == null)
                return new BackupStats();

            return new BackupStats
            {
                TotalFiles = robocopyResult.TotalFiles,
                CopiedFiles = robocopyResult.CopiedFiles,
                SkippedFilesCount = robocopyResult.SkippedFiles,
                FailedFiles = robocopyResult.FailedFiles
            };
        }
    }

    public class ValidationResult
    {
        public bool Valid { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }

        public static ValidationResult Ok()
        {
            return new ValidationResult { Valid = true };
        }

        public static ValidationResult Fail(string errorCode, string message)
        {
            return new ValidationResult
            {
                Valid = false,
                ErrorCode = errorCode,
                ErrorMessage = message
            };
        }
    }

    public class BackupException : Exception
    {
        public string ErrorCode { get; private set; }
        public string AffectedPath { get; private set; }
        public int? WindowsErrorCode { get; private set; }
        public BackupStats Stats { get; private set; }
        public List<string> SkippedFiles { get; private set; }
        public List<string> BlockedFiles { get; private set; }
        public long BytesProcessed { get; private set; }

        public BackupException(
            string errorCode,
            string message,
            string affectedPath = null,
            int? windowsErrorCode = null,
            BackupStats stats = null,
            List<string> skippedFiles = null,
            List<string> blockedFiles = null,
            long bytesProcessed = 0
        )
            : base(message)
        {
            ErrorCode = errorCode;
            AffectedPath = affectedPath;
            WindowsErrorCode = windowsErrorCode;
            Stats = stats ?? new BackupStats();
            SkippedFiles = skippedFiles ?? new List<string>();
            BlockedFiles = blockedFiles ?? new List<string>();
            BytesProcessed = bytesProcessed;
        }
    }
}
