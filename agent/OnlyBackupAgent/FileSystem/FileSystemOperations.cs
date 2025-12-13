using System;
using System.Collections.Generic;
using System.IO;

namespace OnlyBackupAgent.FileSystem
{
    public static class FileSystemOperations
    {
        private const string LongPathPrefix = @"\\?\";
        private const string LongPathUncPrefix = @"\\?\UNC\";

        /// <summary>
        /// Normalizza un percorso per supportare path lunghi su Windows (> 260 caratteri).
        /// Aggiunge il prefisso \\?\ per path locali o \\?\UNC\ per path UNC.
        /// </summary>
        public static string NormalizeLongPath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return path;
            }

            // Normalizza separatori e rimuove doppi backslash interni
            path = path.Replace("/", @"\");
            while (path.Contains(@"\\") && !path.StartsWith(@"\\"))
            {
                path = path.Replace(@"\\", @"\");
            }

            // Se già ha il prefisso long path, ritorna così com'è
            if (path.StartsWith(LongPathPrefix))
            {
                return path;
            }

            // Path UNC: \\server\share -> \\?\UNC\server\share
            if (path.StartsWith(@"\\"))
            {
                return LongPathUncPrefix + path.Substring(2);
            }

            // Path locale: C:\path -> \\?\C:\path
            if (path.Length >= 2 && path[1] == ':')
            {
                return LongPathPrefix + path;
            }

            return path;
        }

        /// <summary>
        /// Normalizza un percorso rimuovendo separatori doppi e normalizzando gli slash.
        /// Non aggiunge il prefisso long path.
        /// </summary>
        public static string NormalizePath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return path;
            }

            // Normalizza separatori
            path = path.Replace("/", @"\");

            // Rimuovi trailing backslash (eccetto per root come C:\)
            path = path.TrimEnd('\\');
            if (path.Length == 2 && path[1] == ':')
            {
                path += @"\";
            }

            // Rimuovi doppi backslash interni (ma non all'inizio per UNC)
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

        /// <summary>
        /// Verifica se due path puntano alla stessa posizione (normalizzando e case-insensitive).
        /// </summary>
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

        /// <summary>
        /// Verifica se un path è contenuto in un altro (overlap).
        /// Ritorna true se childPath è dentro parentPath o viceversa.
        /// </summary>
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

        /// <summary>
        /// Copia una directory usando robocopy per massima affidabilità e compatibilità.
        /// DEPRECATO: Usare direttamente RobocopyEngine per maggior controllo.
        /// Mantenuto per compatibilità con codice esistente.
        /// </summary>
        public static void CopyDirectory(string sourcePath, string destPath, bool recursive = true)
        {
            // Normalizza i path
            string normalizedSource = NormalizePath(sourcePath);
            string normalizedDest = NormalizePath(destPath);

            // Verifica che sorgente e destinazione non siano uguali
            if (PathsAreEqual(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.SOURCE_EQUALS_DESTINATION,
                    String.Format("Sorgente e destinazione sono identiche: {0}", sourcePath),
                    sourcePath
                );
            }

            // Verifica che non ci sia sovrapposizione
            if (PathsOverlap(normalizedSource, normalizedDest))
            {
                throw new BackupException(
                    BackupErrorCodes.PATH_OVERLAP,
                    String.Format("Sorgente e destinazione si sovrappongono: {0} -> {1}", sourcePath, destPath),
                    sourcePath
                );
            }

            // Usa RobocopyEngine per la copia effettiva
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
