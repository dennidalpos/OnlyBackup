using System.Collections.Generic;

namespace BackupAgentService
{
    public class JobConfig
    {
        public string id { get; set; }
        public string name { get; set; }
        public List<string> sources { get; set; }
        public List<DestinationConfig> destinations { get; set; }
        public ScheduleConfig schedule { get; set; }
        public JobOptions options { get; set; }
    }

    public class DestinationConfig
    {
        public string path { get; set; }
        public NetworkCredentialConfig credentials { get; set; }
    }

    public class NetworkCredentialConfig
    {
        public string domain { get; set; }
        public string username { get; set; }
        public string password { get; set; }
    }

    public class ScheduleConfig
    {
        public string type { get; set; }
        public string time { get; set; }
        public int? dayOfWeek { get; set; }
        public int? dayOfMonth { get; set; }
    }

    public class JobOptions
    {
        public string syncMode { get; set; }
    }

    public class JobResult
    {
        public string agentId { get; set; }
        public string jobId { get; set; }
        public string status { get; set; }
        public string startedAt { get; set; }
        public string finishedAt { get; set; }
        public int filesCopied { get; set; }
        public long bytesCopied { get; set; }
        public string errorMessage { get; set; }
        public string trigger { get; set; }
    }
}