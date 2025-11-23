using System;
using System.Runtime.InteropServices;

namespace BackupAgentService
{
    public class NetworkConnectionTestResult
    {
        public bool Success { get; set; }
        public string ErrorMessage { get; set; }
        public int ErrorCode { get; set; }
    }

    public class NetworkConnection : IDisposable
    {
        private readonly string _networkName;

        [DllImport("mpr.dll")]
        private static extern int WNetAddConnection2(ref NETRESOURCE netResource, string password, string username, int flags);

        [DllImport("mpr.dll")]
        private static extern int WNetCancelConnection2(string name, int flags, bool force);

        [StructLayout(LayoutKind.Sequential)]
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

        public static NetworkConnectionTestResult TestConnection(string networkPath, NetworkCredentialConfig credentials)
        {
            var result = new NetworkConnectionTestResult { Success = false };

            if (string.IsNullOrEmpty(networkPath))
            {
                result.ErrorMessage = "Network path is empty";
                return result;
            }

            if (!networkPath.StartsWith(@"\\"))
            {
                result.Success = true;
                return result;
            }

            if (credentials == null)
            {
                result.ErrorMessage = "Credentials required for UNC path";
                return result;
            }

            var unc = GetShareRootStatic(networkPath);
            var netResource = new NETRESOURCE
            {
                dwType = 1,
                lpRemoteName = unc
            };

            string userName = credentials.username;
            if (!string.IsNullOrEmpty(credentials.domain))
                userName = credentials.domain + "\\" + userName;

            int errorCode = WNetAddConnection2(ref netResource, credentials.password, userName, 0);
            result.ErrorCode = errorCode;

            if (errorCode == 0)
            {
                result.Success = true;
                WNetCancelConnection2(unc, 0, true);
            }
            else
            {
                result.Success = false;
                result.ErrorMessage = GetErrorMessage(errorCode);
            }

            return result;
        }

        private static string GetErrorMessage(int errorCode)
        {
            switch (errorCode)
            {
                case 53:
                    return "Network path not found (Error 53)";
                case 86:
                    return "Invalid password (Error 86)";
                case 1219:
                    return "Multiple connections to server with different credentials not allowed (Error 1219)";
                case 1326:
                    return "Username or password is incorrect (Error 1326)";
                case 1203:
                    return "No network provider accepted the given path (Error 1203)";
                case 1208:
                    return "Extended error occurred (Error 1208)";
                case 1222:
                    return "Network path not found or access denied (Error 1222)";
                default:
                    return "Network connection error (Error " + errorCode + ")";
            }
        }

        private static string GetShareRootStatic(string path)
        {
            if (!path.StartsWith(@"\\"))
                return path;
            var parts = path.TrimStart('\\').Split('\\');
            if (parts.Length < 2)
                return path;
            return @"\\" + parts[0] + "\\" + parts[1];
        }

        public NetworkConnection(string networkPath, NetworkCredentialConfig credentials)
        {
            if (string.IsNullOrEmpty(networkPath))
                throw new ArgumentNullException("networkPath");
            var unc = GetShareRootStatic(networkPath);
            _networkName = unc;
            var netResource = new NETRESOURCE
            {
                dwType = 1,
                lpRemoteName = unc
            };
            string userName = credentials.username;
            if (!string.IsNullOrEmpty(credentials.domain))
                userName = credentials.domain + "\\" + userName;
            int result = WNetAddConnection2(ref netResource, credentials.password, userName, 0);
            if (result != 0)
                throw new InvalidOperationException("Error connecting to remote share (code " + result + "): " + GetErrorMessage(result));
        }

        public void Dispose()
        {
            WNetCancelConnection2(_networkName, 0, true);
        }
    }
}
