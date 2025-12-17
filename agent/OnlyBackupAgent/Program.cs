using System;
using System.Configuration.Install;
using System.Reflection;
using System.ServiceProcess;
using OnlyBackupAgent.Service;

namespace OnlyBackupAgent
{
    static class Program
    {
        static void Main(string[] args)
        {
            if (args.Length > 0)
            {
                switch (args[0].ToLower())
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

            ServiceBase[] ServicesToRun;
            ServicesToRun = new ServiceBase[]
            {
                new BackupService()
            };
            ServiceBase.Run(ServicesToRun);
        }

        static void InstallService()
        {
            try
            {
                Console.WriteLine("Installazione servizio OnlyBackup Agent...");
                ManagedInstallerClass.InstallHelper(new string[] { Assembly.GetExecutingAssembly().Location });
                Console.WriteLine("Servizio installato con successo.");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Errore installazione servizio: " + ex.Message);
            }
        }

        static void UninstallService()
        {
            try
            {
                Console.WriteLine("Disinstallazione servizio OnlyBackup Agent...");
                ManagedInstallerClass.InstallHelper(new string[] { "/u", Assembly.GetExecutingAssembly().Location });
                Console.WriteLine("Servizio disinstallato con successo.");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Errore disinstallazione servizio: " + ex.Message);
            }
        }

        static void RunConsole()
        {
            Console.WriteLine("OnlyBackup Agent - Modalità Console");
            Console.WriteLine("Premi CTRL+C per uscire");
            Console.WriteLine();

            var service = new BackupService();
            service.StartConsole();

            Console.WriteLine("Agent avviato. In ascolto sulla porta configurata...");
            Console.WriteLine();

            Console.CancelKeyPress += (sender, e) =>
            {
                Console.WriteLine();
                Console.WriteLine("Arresto agent...");
                service.StopConsole();
                e.Cancel = true;
            };

            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
        }

        static void ShowUsage()
        {
            Console.WriteLine("OnlyBackup Agent");
            Console.WriteLine();
            Console.WriteLine("Utilizzo:");
            Console.WriteLine("  OnlyBackupAgent.exe              Esegui come servizio Windows");
            Console.WriteLine("  OnlyBackupAgent.exe /install     Installa servizio Windows");
            Console.WriteLine("  OnlyBackupAgent.exe /uninstall   Disinstalla servizio Windows");
            Console.WriteLine("  OnlyBackupAgent.exe /console     Esegui in modalità console");
        }
    }
}
