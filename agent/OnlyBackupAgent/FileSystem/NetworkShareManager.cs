using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace OnlyBackupAgent.FileSystem
{
    /// <summary>
    /// Gestisce la connessione alle share di rete SMB/CIFS con supporto per:
    /// - Autenticazione multi-strategia (credenziali esplicite, correnti, guest)
    /// - Retry logic con exponential backoff
    /// - Diagnostica dettagliata degli errori
    /// - Cleanup automatico delle connessioni
    ///
    /// Riferimenti:
    /// - Microsoft WNetAddConnection2: https://learn.microsoft.com/en-us/windows/win32/api/winnetwk/nf-winnetwk-wnetaddconnection2a
    /// - SMB Guest Access: https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/guest-access-in-smb2-is-disabled-by-default
    /// </summary>
    public class NetworkShareManager : IDisposable
    {
        #region Win32 API Declarations

        [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int WNetAddConnection2(ref NETRESOURCE netResource, string password, string username, int flags);

        [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int WNetCancelConnection2(string name, int flags, bool force);

        [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int WNetGetConnection(string localName, System.Text.StringBuilder remoteName, ref int length);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NETRESOURCE
        {
            public int dwScope;
            public int dwType;
            public int dwDisplayType;
            public int dwUsage;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string lpLocalName;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string lpRemoteName;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string lpComment;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string lpProvider;
        }

        #endregion

        #region Constants

        // Resource types
        private const int RESOURCETYPE_DISK = 0x00000001;

        // Connection flags
        private const int CONNECT_TEMPORARY = 0x00000004;
        private const int CONNECT_INTERACTIVE = 0x00000008;
        private const int CONNECT_UPDATE_PROFILE = 0x00000001;

        // Error codes - Connection
        private const int NO_ERROR = 0;
        private const int ERROR_ACCESS_DENIED = 5;
        private const int ERROR_INVALID_PASSWORD = 86;
        private const int ERROR_BAD_NETPATH = 53;
        private const int ERROR_BAD_NET_NAME = 67;
        private const int ERROR_NETWORK_UNREACHABLE = 1231;
        private const int ERROR_BAD_DEVICE = 1200;
        private const int ERROR_ALREADY_ASSIGNED = 85;
        private const int ERROR_INVALID_PARAMETER = 87;
        private const int ERROR_MORE_DATA = 234;

        // Error codes - Authentication
        private const int ERROR_LOGON_FAILURE = 1326;
        private const int ERROR_SESSION_CREDENTIAL_CONFLICT = 1219;
        private const int ERROR_BAD_USERNAME = 2202;
        private const int ERROR_NO_SUCH_LOGON_SESSION = 1312;
        private const int ERROR_NOT_LOGGED_ON = 1245;

        // Error codes - Network
        private const int ERROR_NO_NET_OR_BAD_PATH = 1203;
        private const int ERROR_REM_NOT_LIST = 51;
        private const int ERROR_NETNAME_DELETED = 64;
        private const int ERROR_UNEXP_NET_ERR = 59;
        private const int ERROR_SEM_TIMEOUT = 121;
        private const int ERROR_NETWORK_BUSY = 54;

        // Retry configuration
        private const int DEFAULT_MAX_RETRIES = 3;
        private static readonly int[] DEFAULT_RETRY_DELAYS_MS = { 500, 1000, 2000 };

        #endregion

        #region Properties

        private readonly List<string> _activeConnections = new List<string>();
        private readonly object _lockObject = new object();
        private bool _disposed = false;
        private bool _allowGuestFallback;
        private bool _allowCurrentUserFallback;
        private int _maxRetries;

        /// <summary>
        /// Costruttore - inizializza i valori di default
        /// </summary>
        public NetworkShareManager()
        {
            _allowGuestFallback = true;
            _allowCurrentUserFallback = true;
            _maxRetries = DEFAULT_MAX_RETRIES;
        }

        /// <summary>
        /// Abilita l'autenticazione guest come fallback (default: true)
        /// </summary>
        public bool AllowGuestFallback
        {
            get { return _allowGuestFallback; }
            set { _allowGuestFallback = value; }
        }

        /// <summary>
        /// Abilita l'uso delle credenziali correnti come fallback (default: true)
        /// </summary>
        public bool AllowCurrentUserFallback
        {
            get { return _allowCurrentUserFallback; }
            set { _allowCurrentUserFallback = value; }
        }

        /// <summary>
        /// Numero massimo di tentativi per connessione (default: 3)
        /// </summary>
        public int MaxRetries
        {
            get { return _maxRetries; }
            set { _maxRetries = value; }
        }

        /// <summary>
        /// Log dettagliato delle operazioni
        /// </summary>
        public Action<string> Logger { get; set; }

        #endregion

        #region Public Methods

        /// <summary>
        /// Connette a una share di rete usando una strategia multi-tentativo:
        /// 1. Se fornite credenziali esplicite, prova prima quelle
        /// 2. Prova con le credenziali dell'utente corrente
        /// 3. Prova accesso guest (se abilitato)
        /// </summary>
        /// <param name="uncPath">Percorso UNC completo (es: \\server\share o \\server\share\subfolder)</param>
        /// <param name="credentials">Credenziali opzionali (username, password, domain)</param>
        /// <returns>Risultato della connessione con dettagli diagnostici</returns>
        public ConnectionResult Connect(string uncPath, NetworkCredentials credentials = null)
        {
            if (String.IsNullOrWhiteSpace(uncPath))
            {
                return ConnectionResult.Failure(
                    BackupErrorCodes.UNC_INVALID_FORMAT,
                    "Percorso UNC vuoto o non valido",
                    uncPath,
                    0
                );
            }

            // Estrae la root della share (\\server\share)
            string shareRoot;
            try
            {
                shareRoot = ExtractShareRoot(uncPath);
            }
            catch (ArgumentException ex)
            {
                return ConnectionResult.Failure(
                    BackupErrorCodes.UNC_INVALID_FORMAT,
                    ex.Message,
                    uncPath,
                    0
                );
            }

            Log("Tentativo connessione a: {0} (root: {1})", uncPath, shareRoot);

            // IMPORTANTE: Prima di tentare qualsiasi connessione, disconnetti eventuali
            // connessioni residue alla share. Questo previene conflitti di credenziali
            // che possono verificarsi in modalità sync quando backup successivi tentano
            // di connettersi alla stessa share dopo un errore precedente.
            // Windows può mantenere connessioni parziali anche dopo errori ACCESS_DENIED.
            Log("Pulizia preventiva di eventuali connessioni residue a: {0}", shareRoot);
            ForceDisconnect(shareRoot);
            Thread.Sleep(300); // Attendi che Windows rilasci completamente la connessione

            // Prepara la lista delle strategie di autenticazione da provare
            var strategies = BuildAuthenticationStrategies(credentials);

            ConnectionResult lastResult = null;
            var attemptedStrategies = new List<string>();

            foreach (var strategy in strategies)
            {
                attemptedStrategies.Add(strategy.Name);
                Log("Strategia: {0}", strategy.Name);

                var result = TryConnectWithRetry(shareRoot, strategy);

                if (result.Success)
                {
                    Log("Connessione riuscita con strategia: {0}", strategy.Name);
                    result.UsedStrategy = strategy.Name;
                    return result;
                }

                lastResult = result;
                Log("Strategia {0} fallita: {1} (Windows error: {2})",
                    strategy.Name, result.ErrorMessage, result.WindowsErrorCode);

                // Se l'errore indica che il server/share non esiste, non provare altre strategie
                if (IsPathNotFoundError(result.WindowsErrorCode ?? 0))
                {
                    Log("Errore path non trovato - interrompo i tentativi");
                    break;
                }

                // Se c'e' un conflitto di credenziali o accesso negato, prova a disconnettere e riprovare
                // Questo risolve il problema della modalità sync dove il secondo backup
                // alla stessa share fallisce perché la connessione precedente non è stata
                // completamente rilasciata dal sistema Windows
                if (result.WindowsErrorCode == ERROR_SESSION_CREDENTIAL_CONFLICT ||
                    result.WindowsErrorCode == ERROR_ACCESS_DENIED)
                {
                    Log("Errore {0} - disconnetto e riprovo", result.WindowsErrorCode);
                    ForceDisconnect(shareRoot);

                    // Attendi un momento per permettere al sistema di rilasciare la connessione
                    Thread.Sleep(500);

                    result = TryConnectWithRetry(shareRoot, strategy);
                    if (result.Success)
                    {
                        result.UsedStrategy = strategy.Name + " (dopo disconnect)";
                        return result;
                    }
                }
            }

            // Tutte le strategie fallite
            if (lastResult != null)
            {
                lastResult.AttemptedStrategies = attemptedStrategies.ToArray();
                lastResult.ErrorMessage = BuildDetailedErrorMessage(lastResult, shareRoot, attemptedStrategies);
            }

            return lastResult ?? ConnectionResult.Failure(
                BackupErrorCodes.NETWORK_PATH_NOT_FOUND,
                "Impossibile connettersi alla share di rete",
                shareRoot,
                0
            );
        }

        /// <summary>
        /// Verifica se un percorso di rete e' accessibile
        /// </summary>
        public bool IsShareAccessible(string uncPath)
        {
            try
            {
                string shareRoot = ExtractShareRoot(uncPath);
                return Directory.Exists(shareRoot);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Disconnette una share specifica
        /// </summary>
        public void Disconnect(string uncPath)
        {
            if (String.IsNullOrWhiteSpace(uncPath)) return;

            try
            {
                string shareRoot = ExtractShareRoot(uncPath);
                ForceDisconnect(shareRoot);
            }
            catch (Exception ex)
            {
                Log("Errore durante disconnect di {0}: {1}", uncPath, ex.Message);
            }
        }

        /// <summary>
        /// Disconnette tutte le connessioni attive gestite da questa istanza
        /// </summary>
        public void DisconnectAll()
        {
            lock (_lockObject)
            {
                foreach (var connection in _activeConnections.ToArray())
                {
                    try
                    {
                        WNetCancelConnection2(connection, 0, true);
                        Log("Disconnesso: {0}", connection);
                    }
                    catch (Exception ex)
                    {
                        Log("Errore disconnect {0}: {1}", connection, ex.Message);
                    }
                }
                _activeConnections.Clear();
            }
        }

        #endregion

        #region Private Methods - Connection

        private List<AuthStrategy> BuildAuthenticationStrategies(NetworkCredentials credentials)
        {
            var strategies = new List<AuthStrategy>();

            // 1. Se fornite credenziali esplicite, provale prima
            if (credentials != null && credentials.HasCredentials)
            {
                string fullUsername = BuildFullUsername(credentials.Username, credentials.Domain);
                strategies.Add(new AuthStrategy
                {
                    Name = "Credenziali esplicite",
                    Username = fullUsername,
                    Password = credentials.Password
                });
            }

            // 2. Prova con le credenziali dell'utente corrente (null, null)
            if (AllowCurrentUserFallback)
            {
                strategies.Add(new AuthStrategy
                {
                    Name = "Credenziali utente corrente",
                    Username = null,
                    Password = null
                });
            }

            // 3. Prova accesso guest (username vuoto)
            if (AllowGuestFallback)
            {
                strategies.Add(new AuthStrategy
                {
                    Name = "Accesso guest",
                    Username = "",
                    Password = ""
                });
            }

            return strategies;
        }

        private ConnectionResult TryConnectWithRetry(string shareRoot, AuthStrategy strategy)
        {
            int lastError = 0;
            string lastMessage = "";

            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                if (attempt > 0)
                {
                    int delayMs = attempt < DEFAULT_RETRY_DELAYS_MS.Length
                        ? DEFAULT_RETRY_DELAYS_MS[attempt]
                        : DEFAULT_RETRY_DELAYS_MS[DEFAULT_RETRY_DELAYS_MS.Length - 1];
                    Log("Retry {0}/{1} dopo {2}ms", attempt + 1, MaxRetries, delayMs);
                    Thread.Sleep(delayMs);
                }

                var result = TryConnect(shareRoot, strategy.Username, strategy.Password);

                if (result.Success)
                {
                    return result;
                }

                lastError = result.WindowsErrorCode ?? 0;
                lastMessage = result.ErrorMessage;

                // Non fare retry per errori che non cambieranno
                if (!IsRetryableError(lastError))
                {
                    Log("Errore non ritentabile: {0}", lastError);
                    return result;
                }
            }

            return ConnectionResult.Failure(
                BackupErrorCodes.MapWindowsError(lastError),
                lastMessage,
                shareRoot,
                lastError
            );
        }

        private ConnectionResult TryConnect(string shareRoot, string username, string password)
        {
            var netResource = new NETRESOURCE
            {
                dwType = RESOURCETYPE_DISK,
                lpRemoteName = shareRoot,
                lpLocalName = null,
                lpProvider = null
            };

            int result = WNetAddConnection2(ref netResource, password, username, CONNECT_TEMPORARY);

            if (result == NO_ERROR || result == ERROR_ALREADY_ASSIGNED)
            {
                lock (_lockObject)
                {
                    if (!_activeConnections.Contains(shareRoot))
                    {
                        _activeConnections.Add(shareRoot);
                    }
                }

                return ConnectionResult.Ok(shareRoot);
            }

            string errorCode = BackupErrorCodes.MapWindowsError(result);
            string errorMessage = GetDetailedErrorMessage(result, shareRoot, username);

            return ConnectionResult.Failure(errorCode, errorMessage, shareRoot, result);
        }

        private void ForceDisconnect(string shareRoot)
        {
            try
            {
                // Prova prima una disconnessione normale
                int result = WNetCancelConnection2(shareRoot, 0, false);
                if (result != NO_ERROR)
                {
                    // Se fallisce, forza la disconnessione
                    WNetCancelConnection2(shareRoot, 0, true);
                }

                lock (_lockObject)
                {
                    _activeConnections.Remove(shareRoot);
                }

                Log("Disconnesso forzatamente: {0}", shareRoot);
            }
            catch (Exception ex)
            {
                Log("Errore ForceDisconnect: {0}", ex.Message);
            }
        }

        #endregion

        #region Private Methods - Utilities

        private string ExtractShareRoot(string uncPath)
        {
            if (String.IsNullOrWhiteSpace(uncPath))
            {
                throw new ArgumentException("Percorso UNC vuoto", "uncPath");
            }

            // Rimuove prefisso long path se presente
            string normalizedPath = uncPath;
            if (normalizedPath.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            {
                normalizedPath = @"\\" + normalizedPath.Substring(8);
            }
            else if (normalizedPath.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
            {
                normalizedPath = normalizedPath.Substring(4);
            }

            // Rimuove backslash iniziali e finali
            var trimmedPath = normalizedPath.Trim('\\', '/');
            var parts = trimmedPath.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 2)
            {
                throw new ArgumentException(
                    String.Format("Percorso UNC non valido: '{0}'. Formato atteso: \\\\server\\share", uncPath),
                    "uncPath"
                );
            }

            return @"\\" + parts[0] + @"\" + parts[1];
        }

        private string BuildFullUsername(string username, string domain)
        {
            if (String.IsNullOrEmpty(username))
            {
                return null;
            }

            // Se contiene gia' dominio (domain\user o user@domain), restituisci com'e'
            if (username.Contains(@"\") || username.Contains("@"))
            {
                return username;
            }

            // Aggiungi dominio se specificato
            if (!String.IsNullOrEmpty(domain))
            {
                return domain + @"\" + username;
            }

            return username;
        }

        private bool IsRetryableError(int errorCode)
        {
            // Errori di rete temporanei che possono migliorare con un retry
            return errorCode == ERROR_SEM_TIMEOUT
                || errorCode == ERROR_NETWORK_BUSY
                || errorCode == ERROR_UNEXP_NET_ERR
                || errorCode == ERROR_REM_NOT_LIST
                || errorCode == ERROR_NETWORK_UNREACHABLE;
        }

        private bool IsPathNotFoundError(int errorCode)
        {
            return errorCode == ERROR_BAD_NETPATH
                || errorCode == ERROR_BAD_NET_NAME
                || errorCode == ERROR_NO_NET_OR_BAD_PATH;
        }

        private string GetDetailedErrorMessage(int errorCode, string sharePath, string username)
        {
            string baseMessage = BackupErrorCodes.GetWindowsErrorMessage(errorCode);

            switch (errorCode)
            {
                case ERROR_BAD_NETPATH:
                    return String.Format("{0}. Verificare che il server sia raggiungibile (ping, DNS). Path: {1}", baseMessage, sharePath);

                case ERROR_BAD_NET_NAME:
                    return String.Format("{0}. La share '{1}' potrebbe non esistere o il servizio SMB non e' attivo sul server.", baseMessage, sharePath);

                case ERROR_ACCESS_DENIED:
                    return String.Format("{0}. L'utente '{1}' non ha i permessi per accedere a {2}.", baseMessage, username ?? "(corrente)", sharePath);

                case ERROR_LOGON_FAILURE:
                case ERROR_INVALID_PASSWORD:
                    return String.Format("{0}. Verificare username e password per {1}.", baseMessage, sharePath);

                case ERROR_SESSION_CREDENTIAL_CONFLICT:
                    return String.Format("{0}. Esiste gia' una connessione a {1} con credenziali diverse. Disconnettersi prima o riavviare il servizio.", baseMessage, sharePath);

                case ERROR_NETWORK_UNREACHABLE:
                    return String.Format("{0}. Il server non e' raggiungibile. Verificare connettivita' di rete e firewall. Path: {1}", baseMessage, sharePath);

                case ERROR_NOT_LOGGED_ON:
                    return String.Format("{0}. L'accesso guest potrebbe essere disabilitato su {1}. Abilitare AllowInsecureGuestAuth o fornire credenziali.", baseMessage, sharePath);

                default:
                    return String.Format("{0} (codice Windows: {1})", baseMessage, errorCode);
            }
        }

        private string BuildDetailedErrorMessage(ConnectionResult result, string sharePath, List<string> attemptedStrategies)
        {
            var suggestions = new List<string>();

            int errorCode = result.WindowsErrorCode ?? 0;

            // Suggerimenti basati sull'errore
            if (errorCode == ERROR_BAD_NET_NAME || errorCode == ERROR_BAD_NETPATH)
            {
                suggestions.Add("Verificare che il nome del server sia corretto");
                suggestions.Add("Verificare che la share esista sul server (net share)");
                suggestions.Add("Verificare che il servizio Server (LanmanServer) sia attivo");
                suggestions.Add("Provare: ping " + ExtractServerName(sharePath));
            }
            else if (errorCode == ERROR_ACCESS_DENIED || errorCode == ERROR_LOGON_FAILURE)
            {
                suggestions.Add("Verificare username e password");
                suggestions.Add("Verificare i permessi della share e NTFS");
                suggestions.Add("Se il NAS/server usa accesso guest, potrebbe essere necessario:");
                suggestions.Add("  - Abilitare AllowInsecureGuestAuth nel registro di Windows");
                suggestions.Add("  - Oppure creare un utente dedicato sul NAS con password");
            }
            else if (errorCode == ERROR_SESSION_CREDENTIAL_CONFLICT)
            {
                suggestions.Add("Eseguire: net use \\\\" + ExtractServerName(sharePath) + " /delete");
                suggestions.Add("Oppure riavviare il servizio OnlyBackup Agent");
            }
            else if (errorCode == ERROR_NETWORK_UNREACHABLE)
            {
                suggestions.Add("Verificare che il server sia acceso e raggiungibile");
                suggestions.Add("Verificare le impostazioni del firewall");
                suggestions.Add("Verificare che la porta TCP 445 (SMB) sia aperta");
            }

            string message = String.Format(
                "Impossibile connettersi a {0}. Errore: {1}\nStrategie tentate: {2}",
                sharePath,
                result.ErrorMessage,
                String.Join(", ", attemptedStrategies.ToArray())
            );

            if (suggestions.Count > 0)
            {
                message += "\n\nSuggerimenti:\n- " + String.Join("\n- ", suggestions.ToArray());
            }

            return message;
        }

        private string ExtractServerName(string sharePath)
        {
            try
            {
                var trimmed = sharePath.TrimStart('\\', '/');
                var parts = trimmed.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
                return parts.Length > 0 ? parts[0] : sharePath;
            }
            catch
            {
                return sharePath;
            }
        }

        private void Log(string format, params object[] args)
        {
            if (Logger != null)
            {
                try
                {
                    Logger(String.Format("[NetworkShareManager] " + format, args));
                }
                catch { }
            }
        }

        #endregion

        #region IDisposable

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                if (disposing)
                {
                    DisconnectAll();
                }
                _disposed = true;
            }
        }

        ~NetworkShareManager()
        {
            Dispose(false);
        }

        #endregion
    }

    #region Supporting Classes

    /// <summary>
    /// Credenziali per l'accesso alle share di rete
    /// </summary>
    public class NetworkCredentials
    {
        public string Username { get; set; }
        public string Password { get; set; }
        public string Domain { get; set; }

        public bool HasCredentials
        {
            get { return !String.IsNullOrEmpty(Username); }
        }

        public static NetworkCredentials FromDictionary(IDictionary<string, object> dict)
        {
            if (dict == null) return null;

            var creds = new NetworkCredentials();

            if (dict.ContainsKey("username") && dict["username"] != null)
                creds.Username = dict["username"].ToString();

            if (dict.ContainsKey("password") && dict["password"] != null)
                creds.Password = dict["password"].ToString();

            if (dict.ContainsKey("domain") && dict["domain"] != null)
                creds.Domain = dict["domain"].ToString();

            return creds;
        }
    }

    /// <summary>
    /// Risultato di una operazione di connessione
    /// </summary>
    public class ConnectionResult
    {
        public bool Success { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public int? WindowsErrorCode { get; set; }
        public string SharePath { get; set; }
        public string UsedStrategy { get; set; }
        public string[] AttemptedStrategies { get; set; }

        public static ConnectionResult Ok(string sharePath)
        {
            return new ConnectionResult
            {
                Success = true,
                ErrorCode = BackupErrorCodes.SUCCESS,
                SharePath = sharePath
            };
        }

        public static ConnectionResult Failure(string errorCode, string message, string sharePath, int windowsError)
        {
            return new ConnectionResult
            {
                Success = false,
                ErrorCode = errorCode,
                ErrorMessage = message,
                SharePath = sharePath,
                WindowsErrorCode = windowsError
            };
        }

        /// <summary>
        /// Converte in BackupResult per compatibilita'
        /// </summary>
        public BackupResult ToBackupResult()
        {
            if (Success)
            {
                return new BackupResult { Success = true };
            }

            return BackupResult.CreateError(
                ErrorCode,
                ErrorMessage,
                SharePath,
                WindowsErrorCode
            );
        }
    }

    /// <summary>
    /// Strategia di autenticazione interna
    /// </summary>
    internal class AuthStrategy
    {
        public string Name { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
    }

    #endregion
}
