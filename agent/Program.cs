using System;
using System.ServiceProcess;

namespace BackupAgentService
{
    static class Program
    {
        static void Main(string[] args)
        {
#if DEBUG
            var svc = new BackupService();
            svc.DebugRun();
            Console.WriteLine("Press ENTER to exit...");
            Console.ReadLine();
#else
            ServiceBase[] ServicesToRun;
            ServicesToRun = new ServiceBase[]
            {
                new BackupService()
            };
            ServiceBase.Run(ServicesToRun);
#endif
        }
    }
}