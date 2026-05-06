using System;
using System.Configuration.Install;
using System.Reflection;
using System.ServiceProcess;
using OnlyBackupServerService.Service;

namespace OnlyBackupServerService
{
    static class Program
    {
        static void Main(string[] args)
        {
            if (args.Length > 0)
            {
                switch (args[0].ToLowerInvariant())
                {
                    case "/install":
                    case "-install":
                        InstallService();
                        return;

                    case "/uninstall":
                    case "-uninstall":
                        UninstallService();
                        return;

                    case "/console":
                    case "-console":
                        RunConsole();
                        return;

                    default:
                        ShowUsage();
                        return;
                }
            }

            ServiceBase.Run(new ServiceBase[] { new NodeServerService() });
        }

        static void InstallService()
        {
            ManagedInstallerClass.InstallHelper(new[] { Assembly.GetExecutingAssembly().Location });
            Console.WriteLine("Servizio OnlyBackup Server installato.");
        }

        static void UninstallService()
        {
            ManagedInstallerClass.InstallHelper(new[] { "/u", Assembly.GetExecutingAssembly().Location });
            Console.WriteLine("Servizio OnlyBackup Server disinstallato.");
        }

        static void RunConsole()
        {
            Console.WriteLine("OnlyBackup Server Service - modalita console");
            Console.WriteLine("Premi CTRL+C per uscire.");

            var service = new NodeServerService();
            service.StartConsole();

            Console.CancelKeyPress += (sender, eventArgs) =>
            {
                eventArgs.Cancel = true;
                service.StopConsole();
            };

            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
        }

        static void ShowUsage()
        {
            Console.WriteLine("OnlyBackup Server Service");
            Console.WriteLine();
            Console.WriteLine("Utilizzo:");
            Console.WriteLine("  OnlyBackupServerService.exe              Esegui come servizio Windows");
            Console.WriteLine("  OnlyBackupServerService.exe /install     Installa servizio Windows");
            Console.WriteLine("  OnlyBackupServerService.exe /uninstall   Disinstalla servizio Windows");
            Console.WriteLine("  OnlyBackupServerService.exe /console     Esegui in modalita console");
        }
    }
}
