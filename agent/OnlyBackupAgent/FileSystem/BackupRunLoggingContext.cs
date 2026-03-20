using System;

namespace OnlyBackupAgent.FileSystem
{
    internal class BackupRunLoggingContext
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
}
