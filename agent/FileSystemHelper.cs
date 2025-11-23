using System;
using System.Collections.Generic;
using System.IO;

namespace BackupAgentService
{
    public class FileSystemBrowseResult
    {
        public string path { get; set; }
        public List<FileSystemEntry> directories { get; set; }
        public List<FileSystemEntry> files { get; set; }
    }

    public class FileSystemEntry
    {
        public string name { get; set; }
        public string fullPath { get; set; }
        public long size { get; set; }
    }

    public class CopyContext
    {
        public int FilesCopied { get; set; }
        public long BytesCopied { get; set; }
    }

    public class PathValidationResult
    {
        public bool IsValid { get; set; }
        public string ErrorMessage { get; set; }
    }

    public static class FileSystemHelper
    {
        private const int MAX_PATH_LENGTH = 248;
        private const int MAX_FILENAME_LENGTH = 260;

        public static FileSystemBrowseResult Browse(string path)
        {
            var res = new FileSystemBrowseResult
            {
                path = path,
                directories = new List<FileSystemEntry>(),
                files = new List<FileSystemEntry>()
            };
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                {
                    foreach (var drive in DriveInfo.GetDrives())
                    {
                        if (!drive.IsReady)
                            continue;
                        res.directories.Add(new FileSystemEntry
                        {
                            name = drive.Name,
                            fullPath = drive.RootDirectory.FullName
                        });
                    }
                    return res;
                }
                if (!Directory.Exists(path))
                    return res;
                foreach (var dir in Directory.GetDirectories(path))
                {
                    var di = new DirectoryInfo(dir);
                    res.directories.Add(new FileSystemEntry
                    {
                        name = di.Name,
                        fullPath = di.FullName
                    });
                }
                foreach (var file in Directory.GetFiles(path))
                {
                    var fi = new FileInfo(file);
                    res.files.Add(new FileSystemEntry
                    {
                        name = fi.Name,
                        fullPath = fi.FullName,
                        size = fi.Length
                    });
                }
            }
            catch
            {
            }
            return res;
        }

        public static PathValidationResult ValidatePath(string path)
        {
            var result = new PathValidationResult { IsValid = true };

            if (string.IsNullOrWhiteSpace(path))
            {
                result.IsValid = false;
                result.ErrorMessage = "Path is empty or null";
                return result;
            }

            if (path.Length > MAX_FILENAME_LENGTH)
            {
                result.IsValid = false;
                result.ErrorMessage = "Path exceeds maximum length of " + MAX_FILENAME_LENGTH + " characters (current: " + path.Length + ")";
                return result;
            }

            try
            {
                var dirPath = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dirPath) && dirPath.Length > MAX_PATH_LENGTH)
                {
                    result.IsValid = false;
                    result.ErrorMessage = "Directory path exceeds maximum length of " + MAX_PATH_LENGTH + " characters";
                    return result;
                }
            }
            catch (Exception ex)
            {
                result.IsValid = false;
                result.ErrorMessage = "Invalid path format: " + ex.Message;
                return result;
            }

            return result;
        }

        public static CopyContext CopyDirectory(string sourceDir, string destDir, bool mirror)
        {
            var ctx = new CopyContext();
            Directory.CreateDirectory(destDir);
            var sourceFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
            {
                var rel = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                sourceFiles.Add(rel);
                var targetFile = Path.Combine(destDir, rel);

                var validation = ValidatePath(targetFile);
                if (!validation.IsValid)
                {
                    continue;
                }

                var targetDir = Path.GetDirectoryName(targetFile);
                if (!Directory.Exists(targetDir))
                    Directory.CreateDirectory(targetDir);
                CopyFileInternal(file, targetFile, ctx);
            }
            if (mirror)
            {
                foreach (var file in Directory.GetFiles(destDir, "*", SearchOption.AllDirectories))
                {
                    var rel = file.Substring(destDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    if (!sourceFiles.Contains(rel))
                    {
                        try
                        {
                            File.Delete(file);
                        }
                        catch
                        {
                        }
                    }
                }
            }
            return ctx;
        }

        public static CopyContext CopyFile(string sourceFile, string destFile)
        {
            var ctx = new CopyContext();

            var validation = ValidatePath(destFile);
            if (!validation.IsValid)
            {
                return ctx;
            }

            var dir = Path.GetDirectoryName(destFile);
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            CopyFileInternal(sourceFile, destFile, ctx);
            return ctx;
        }

        private static void CopyFileInternal(string sourceFile, string destFile, CopyContext ctx)
        {
            try
            {
                var srcInfo = new FileInfo(sourceFile);
                bool copy = true;
                if (File.Exists(destFile))
                {
                    var destInfo = new FileInfo(destFile);
                    if (destInfo.LastWriteTimeUtc >= srcInfo.LastWriteTimeUtc && destInfo.Length == srcInfo.Length)
                        copy = false;
                }
                if (copy)
                {
                    File.Copy(sourceFile, destFile, true);
                    ctx.FilesCopied++;
                    ctx.BytesCopied += srcInfo.Length;
                }
            }
            catch
            {
            }
        }

        public static bool CanAccessDestination(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                    return false;

                var validation = ValidatePath(path);
                if (!validation.IsValid)
                    return false;

                if (!Directory.Exists(path))
                    Directory.CreateDirectory(path);
                string testFile = Path.Combine(path, "__sb_test_" + Guid.NewGuid().ToString("N") + ".tmp");
                File.WriteAllText(testFile, "test");
                File.Delete(testFile);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}