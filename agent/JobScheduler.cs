using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace BackupAgentService
{
    public class JobScheduler
    {
        private readonly List<JobConfig> _jobs = new List<JobConfig>();
        private readonly Dictionary<string, DateTime> _nextRunTimes = new Dictionary<string, DateTime>();
        private readonly Timer _timer;
        private readonly Action<string> _log;
        private readonly Action<JobResult> _sendResult;
        private readonly object _sync = new object();
        private readonly string _agentId;
        private const int MAX_PATH_LENGTH = 248;
        private const int MAX_RETRIES = 3;
        private const int RETRY_DELAY_MS = 5000;

        public JobScheduler(Action<string> log, Action<JobResult> sendResult)
        {
            _log = log;
            _sendResult = sendResult;
            _agentId = Environment.MachineName;
            _timer = new Timer(TimerCallback, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
        }

        public void UpdateJobs(List<JobConfig> jobs)
        {
            lock (_sync)
            {
                _jobs.Clear();
                if (jobs != null)
                    _jobs.AddRange(jobs);
                _nextRunTimes.Clear();
                foreach (var job in _jobs)
                {
                    if (string.IsNullOrEmpty(job.id))
                        continue;
                    _nextRunTimes[job.id] = CalculateNextRun(job);
                }
            }
        }

        public void RunJobNow(string jobId)
        {
            JobConfig job = null;
            lock (_sync)
            {
                job = _jobs.Find(j => j.id == jobId);
            }
            if (job == null)
            {
                _log("RunJobNow: job " + jobId + " non trovato");
                return;
            }
            RunJob(job, "manual");
        }

        private void TimerCallback(object state)
        {
            var toRun = new List<JobConfig>();
            lock (_sync)
            {
                var now = DateTime.Now;
                foreach (var job in _jobs)
                {
                    if (string.IsNullOrEmpty(job.id))
                        continue;
                    DateTime next;
                    if (!_nextRunTimes.TryGetValue(job.id, out next))
                    {
                        next = CalculateNextRun(job);
                        _nextRunTimes[job.id] = next;
                    }
                    if (now >= next)
                    {
                        toRun.Add(job);
                        _nextRunTimes[job.id] = CalculateNextRun(job);
                    }
                }
            }
            foreach (var job in toRun)
            {
                RunJob(job, "schedule");
            }
        }

        private DateTime CalculateNextRun(JobConfig job)
        {
            var s = job.schedule ?? new ScheduleConfig { type = "daily", time = "23:00" };
            TimeSpan time;
            if (!TimeSpan.TryParse(s.time ?? "23:00", out time))
                time = new TimeSpan(23, 0, 0);
            var now = DateTime.Now;
            if (string.Equals(s.type, "weekly", StringComparison.OrdinalIgnoreCase))
            {
                int dow = s.dayOfWeek ?? 1;
                var target = new DateTime(now.Year, now.Month, now.Day, time.Hours, time.Minutes, 0);
                while ((int)target.DayOfWeek != dow || target <= now)
                    target = target.AddDays(1);
                return target;
            }
            if (string.Equals(s.type, "monthly", StringComparison.OrdinalIgnoreCase))
            {
                int dom = s.dayOfMonth ?? 1;
                int daysInMonth = DateTime.DaysInMonth(now.Year, now.Month);
                if (dom > daysInMonth)
                    dom = daysInMonth;
                var target = new DateTime(now.Year, now.Month, dom, time.Hours, time.Minutes, 0);
                if (target <= now)
                {
                    var nextMonth = now.AddMonths(1);
                    daysInMonth = DateTime.DaysInMonth(nextMonth.Year, nextMonth.Month);
                    if (dom > daysInMonth)
                        dom = daysInMonth;
                    target = new DateTime(nextMonth.Year, nextMonth.Month, dom, time.Hours, time.Minutes, 0);
                }
                return target;
            }
            var t = new DateTime(now.Year, now.Month, now.Day, time.Hours, time.Minutes, 0);
            if (t <= now)
                t = t.AddDays(1);
            return t;
        }

        private void RunJob(JobConfig job, string trigger)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                var result = new JobResult
                {
                    agentId = _agentId,
                    jobId = job.id,
                    trigger = trigger,
                    startedAt = DateTime.UtcNow.ToString("o"),
                    status = "success",
                    filesCopied = 0,
                    bytesCopied = 0
                };
                var errors = new List<string>();
                try
                {
                    _log("Running job " + job.id + " " + job.name + " trigger=" + trigger);

                    var validationErrors = ValidateJobPaths(job);
                    if (validationErrors.Count > 0)
                    {
                        result.status = "failed";
                        result.errorMessage = string.Join(" | ", validationErrors);
                        _log("Job validation failed: " + result.errorMessage);
                        return;
                    }

                    string syncMode = job.options != null && !string.IsNullOrEmpty(job.options.syncMode)
                        ? job.options.syncMode
                        : "copy";

                    foreach (var src in job.sources ?? new List<string>())
                    {
                        if (string.IsNullOrWhiteSpace(src))
                            continue;
                        var sourcePath = src.Trim();
                        bool isDir = Directory.Exists(sourcePath);
                        bool isFile = File.Exists(sourcePath);
                        if (!isDir && !isFile)
                        {
                            var msg = "Source not found or inaccessible: " + sourcePath;
                            _log(msg);
                            errors.Add(msg);
                            result.status = "failed";
                            continue;
                        }
                        foreach (var dest in job.destinations ?? new List<DestinationConfig>())
                        {
                            if (dest == null || string.IsNullOrEmpty(dest.path))
                                continue;

                            bool success = false;
                            string lastError = null;

                            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++)
                            {
                                NetworkConnection netConn = null;
                                try
                                {
                                    if (dest.credentials != null && dest.path.StartsWith(@"\\"))
                                        netConn = new NetworkConnection(dest.path, dest.credentials);
                                    var targetRoot = dest.path;
                                    if (!Directory.Exists(targetRoot))
                                        Directory.CreateDirectory(targetRoot);
                                    if (isDir)
                                    {
                                        var srcDirName = new DirectoryInfo(sourcePath).Name;
                                        var targetDir = Path.Combine(targetRoot, srcDirName);
                                        var ctx = FileSystemHelper.CopyDirectory(sourcePath, targetDir, syncMode == "sync");
                                        result.filesCopied += ctx.FilesCopied;
                                        result.bytesCopied += ctx.BytesCopied;
                                    }
                                    else if (isFile)
                                    {
                                        var fileName = Path.GetFileName(sourcePath);
                                        var targetFile = Path.Combine(targetRoot, fileName);
                                        var ctx = FileSystemHelper.CopyFile(sourcePath, targetFile);
                                        result.filesCopied += ctx.FilesCopied;
                                        result.bytesCopied += ctx.BytesCopied;
                                    }
                                    success = true;
                                    if (attempt > 1)
                                        _log("Retry succeeded on attempt " + attempt + " for " + sourcePath + " -> " + dest.path);
                                    break;
                                }
                                catch (UnauthorizedAccessException ex)
                                {
                                    lastError = "UnauthorizedAccess: " + ex.Message;
                                    if (attempt < MAX_RETRIES)
                                    {
                                        _log("Retry " + attempt + "/" + MAX_RETRIES + " failed: " + lastError);
                                        Thread.Sleep(RETRY_DELAY_MS);
                                    }
                                }
                                catch (DirectoryNotFoundException ex)
                                {
                                    lastError = "DirectoryNotFound: " + ex.Message;
                                    break;
                                }
                                catch (IOException ex)
                                {
                                    lastError = "IOException: " + ex.Message;
                                    if (attempt < MAX_RETRIES)
                                    {
                                        _log("Retry " + attempt + "/" + MAX_RETRIES + " failed: " + lastError);
                                        Thread.Sleep(RETRY_DELAY_MS);
                                    }
                                }
                                catch (Exception ex)
                                {
                                    lastError = "GenericError: " + ex.Message;
                                    if (attempt < MAX_RETRIES)
                                    {
                                        _log("Retry " + attempt + "/" + MAX_RETRIES + " failed: " + lastError);
                                        Thread.Sleep(RETRY_DELAY_MS);
                                    }
                                }
                                finally
                                {
                                    if (netConn != null)
                                        netConn.Dispose();
                                }
                            }

                            if (!success)
                            {
                                var msg = "Failed after " + MAX_RETRIES + " attempts: source=" + sourcePath + 
                                         " dest=" + dest.path + " error=" + lastError;
                                _log(msg);
                                errors.Add(msg);
                                result.status = "failed";
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    result.status = "failed";
                    var msg = "Error running job " + job.id + ": " + ex;
                    result.errorMessage = msg;
                    _log(msg);
                }
                finally
                {
                    if (errors.Count > 0)
                    {
                        var errText = string.Join(" | ", errors);
                        if (string.IsNullOrEmpty(result.errorMessage))
                            result.errorMessage = errText;
                        else
                            result.errorMessage += " | " + errText;
                    }
                    result.finishedAt = DateTime.UtcNow.ToString("o");
                    _sendResult(result);
                }
            });
        }

        private List<string> ValidateJobPaths(JobConfig job)
        {
            var errors = new List<string>();

            foreach (var src in job.sources ?? new List<string>())
            {
                if (string.IsNullOrWhiteSpace(src))
                    continue;

                var sourcePath = src.Trim();
                if (sourcePath.Length > MAX_PATH_LENGTH)
                {
                    errors.Add("Source path exceeds " + MAX_PATH_LENGTH + " characters: " + sourcePath.Substring(0, Math.Min(50, sourcePath.Length)) + "...");
                }
            }

            foreach (var dest in job.destinations ?? new List<DestinationConfig>())
            {
                if (dest == null || string.IsNullOrEmpty(dest.path))
                    continue;

                if (dest.path.Length > MAX_PATH_LENGTH)
                {
                    errors.Add("Destination path exceeds " + MAX_PATH_LENGTH + " characters: " + dest.path.Substring(0, Math.Min(50, dest.path.Length)) + "...");
                }
            }

            return errors;
        }
    }
}