using System.ComponentModel;
using System.Configuration.Install;
using System.ServiceProcess;

namespace OnlyBackupAgent.Service
{
    [RunInstaller(true)]
    public class OnlyBackupServiceInstaller : Installer
    {
        public OnlyBackupServiceInstaller()
        {
            var processInstaller = new ServiceProcessInstaller
            {
                Account = ServiceAccount.LocalSystem
            };

            var serviceInstaller = new ServiceInstaller
            {
                ServiceName = "OnlyBackupAgent",
                DisplayName = "OnlyBackup Agent",
                Description = "Agente per il sistema di backup/restore centralizzato OnlyBackup",
                StartType = ServiceStartMode.Automatic
            };

            Installers.Add(processInstaller);
            Installers.Add(serviceInstaller);
        }
    }
}
