using System.ComponentModel;
using System.Configuration.Install;
using System.ServiceProcess;

namespace OnlyBackupServerService.Service
{
    [RunInstaller(true)]
    public class OnlyBackupServerServiceInstaller : Installer
    {
        public OnlyBackupServerServiceInstaller()
        {
            var processInstaller = new ServiceProcessInstaller
            {
                Account = ServiceAccount.LocalSystem
            };

            var serviceInstaller = new ServiceInstaller
            {
                ServiceName = "OnlyBackupServer",
                DisplayName = "OnlyBackup Server",
                Description = "Server web e API per il sistema di backup/restore centralizzato OnlyBackup",
                StartType = ServiceStartMode.Automatic
            };

            Installers.Add(processInstaller);
            Installers.Add(serviceInstaller);
        }
    }
}
