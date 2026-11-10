using System;
using System.Collections.Generic;
using System.IO;

namespace OnlyBackupAgent.FileSystem
{
    public static class FileSystemOperations
    {
        private const string LongPathPrefix = @"\\?\";
        private const string LongPathUncPrefix = @"\\?\UNC\";

        public static string NormalizeLongPath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return path;
            }

            path = path.Replace("/", @"\");
            while (path.Contains(@"\\") && !path.StartsWith(@"\\"))
            {
                path = path.Replace(@"\\", @"\");
            }

            if (path.StartsWith(LongPathPrefix))
            {
                return path;
            }

            if (path.StartsWith(@"\\"))
            {
                return LongPathUncPrefix + path.Substring(2);
            }

            if (path.Length >= 2 && path[1] == ':')
            {
                return LongPathPrefix + path;
            }

            return path;
        }

        public static string NormalizePath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return path;
            }

            path = path.Replace("/", @"\");

            path = path.TrimEnd('\\');
            if (path.Length == 2 && path[1] == ':')
            {
                path += @"\";
            }

            if (path.StartsWith(@"\\"))
            {
                string uncPart = @"\\";
                string rest = path.Substring(2);
                while (rest.Contains(@"\\"))
                {
                    rest = rest.Replace(@"\\", @"\");
                }
                path = uncPart + rest;
            }
            else
            {
                while (path.Contains(@"\\"))
                {
                    path = path.Replace(@"\\", @"\");
                }
            }

            return path;
        }

        public static bool PathsAreEqual(string path1, string path2)
        {
            if (String.IsNullOrWhiteSpace(path1) || String.IsNullOrWhiteSpace(path2))
            {
                return false;
            }

            string normalized1 = NormalizePath(path1).TrimEnd('\\');
            string normalized2 = NormalizePath(path2).TrimEnd('\\');

            return String.Equals(normalized1, normalized2, StringComparison.OrdinalIgnoreCase);
        }

        public static bool PathsOverlap(string path1, string path2)
        {
            if (String.IsNullOrWhiteSpace(path1) || String.IsNullOrWhiteSpace(path2))
            {
                return false;
            }

            string normalized1 = NormalizePath(path1).TrimEnd('\\') + @"\";
            string normalized2 = NormalizePath(path2).TrimEnd('\\') + @"\";

            return normalized1.StartsWith(normalized2, StringComparison.OrdinalIgnoreCase) ||
                   normalized2.StartsWith(normalized1, StringComparison.OrdinalIgnoreCase);
        }

        public static object ListDirectory(string path)
        {
            var result = new
            {
                path = path,
                items = new List<object>()
            };

            try
            {
                if (string.IsNullOrEmpty(path) || path == "/")
                {
                    DriveInfo[] drives = DriveInfo.GetDrives();
                    foreach (var drive in drives)
                    {
                        if (drive.IsReady)
                        {
                            ((List<object>)result.items).Add(new
                            {
                                name = drive.Name,
                                type = "drive",
                                size = drive.TotalSize,
                                freeSpace = drive.AvailableFreeSpace
                            });
                        }
                    }
                }
                else
                {
                    DirectoryInfo dirInfo = new DirectoryInfo(path);

                    if (!dirInfo.Exists)
                    {
                        throw new Exception("Directory non trovata");
                    }

                    foreach (var dir in dirInfo.GetDirectories())
                    {
                        try
                        {
                            ((List<object>)result.items).Add(new
                            {
                                name = dir.Name,
                                type = "directory",
                                path = dir.FullName,
                                modified = dir.LastWriteTime.ToString("o")
                            });
                        }
                        catch
                        {
                        }
                    }

                    foreach (var file in dirInfo.GetFiles())
                    {
                        try
                        {
                            ((List<object>)result.items).Add(new
                            {
                                name = file.Name,
                                type = "file",
                                path = file.FullName,
                                size = file.Length,
                                modified = file.LastWriteTime.ToString("o")
                            });
                        }
                        catch
                        {
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                throw new Exception(String.Format("Errore lettura directory: {0}", ex.Message));
            }

            return result;
        }

        public static void CopyDirectory(string sourcePath, string destPath, bool recursive = true)
        {
            string normalizedSource = NormalizePath(sourcePath);
            string normalizedDest = NormalizePath(destPath);

            if (PathsAreEqual(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.SOURCE_EQUALS_DESTINATION,
                    String.Format("Sorgente e destinazione sono identiche: {0}", sourcePath),
                    sourcePath
                );
            }

            if (PathsOverlap(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.PATH_OVERLAP,
                    String.Format("Sorgente e destinazione si sovrappongono: {0} -> {1}", sourcePath, destPath),
                    sourcePath
                );
            }

            var robocopy = new RobocopyEngine();
            var result = robocopy.Copy(normalizedSource, normalizedDest, false);

            if (!result.Success)
            {
                var backupResult = result.ToBackupResult();
                throw new BackupException(
                    backupResult.ErrorCode,
                    backupResult.ErrorMessage,
                    sourcePath
                );
            }
        }

        public static long GetDirectorySize(string path)
        {
            DirectoryInfo dirInfo = new DirectoryInfo(path);

            if (!dirInfo.Exists)
                return 0;

            long size = 0;

            try
            {
                foreach (FileInfo file in dirInfo.GetFiles())
                {
                    try
                    {
                        size += file.Length;
                    }
                    catch
                    {
                    }
                }

                foreach (DirectoryInfo subDir in dirInfo.GetDirectories())
                {
                    try
                    {
                        size += GetDirectorySize(subDir.FullName);
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }

            return size;
        }
    }
}
