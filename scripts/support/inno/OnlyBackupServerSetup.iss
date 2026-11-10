#ifndef SourceDir
  #error SourceDir is required. Pass /DSourceDir=<package root>.
#endif

#ifndef OutputDir
  #define OutputDir SourceDir
#endif

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#define AppName "OnlyBackup Server"
#define AppPublisher "OnlyBackup"
#define AdminUiUrl "http://localhost:8080/server-settings.html"

[Setup]
AppId={{6F2B6B77-78E6-4EF2-A0D2-74D29F62629E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright=Copyright (c) 2026 OnlyBackup Server
DefaultDirName={autopf}\OnlyBackup\Server
DefaultGroupName=OnlyBackup Server
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=OnlyBackupServerSetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
SetupIconFile={#SourceDir}\assets\brand\favicon.ico
UninstallDisplayIcon={app}\assets\brand\favicon.ico
LicenseFile={#SourceDir}\LICENSE
WizardStyle=modern

[Tasks]
Name: "desktopadminui"; Description: "Crea un collegamento sul desktop alla UI admin"; GroupDescription: "Collegamenti:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\data"
Name: "{app}\logs"

[INI]
Filename: "{group}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#AdminUiUrl}"
Filename: "{group}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\assets\brand\favicon.ico"
Filename: "{group}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"
Filename: "{commondesktop}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#AdminUiUrl}"; Tasks: desktopadminui
Filename: "{commondesktop}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\assets\brand\favicon.ico"; Tasks: desktopadminui
Filename: "{commondesktop}\OnlyBackup Admin UI.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"; Tasks: desktopadminui

[Icons]
Name: "{group}\Installa servizio OnlyBackup Server"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoExit -ExecutionPolicy Bypass -File ""{app}\Install-OnlyBackupServer.ps1"" -StartService"; WorkingDir: "{app}"; IconFilename: "{app}\assets\brand\favicon.ico"
Name: "{group}\Rimuovi servizio OnlyBackup Server"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoExit -ExecutionPolicy Bypass -File ""{app}\Uninstall-OnlyBackupServer.ps1"" -Force"; WorkingDir: "{app}"; IconFilename: "{app}\assets\brand\favicon.ico"

[Run]
Filename: "{app}\prerequisites\NDP462-KB3151800-x86-x64-AllOS-ENU.exe"; Parameters: "/q /norestart"; StatusMsg: "Installazione .NET Framework 4.6.2..."; Check: NeedsDotNet462; Flags: waituntilterminated skipifdoesntexist
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Install-OnlyBackupServer.ps1"" -InitialAdminPasswordFile ""{tmp}\onlybackup-admin-password.txt"" -StartService"; WorkingDir: "{app}"; StatusMsg: "Installazione e avvio servizio OnlyBackup Server..."; BeforeInstall: WriteAdminPasswordFile; Flags: waituntilterminated

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Uninstall-OnlyBackupServer.ps1"" -Force"; RunOnceId: "OnlyBackupServerServiceUninstall"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: files; Name: "{group}\OnlyBackup Admin UI.url"
Type: files; Name: "{commondesktop}\OnlyBackup Admin UI.url"

[Code]
var
  AdminPasswordPage: TInputQueryWizardPage;

procedure InitializeWizard();
var
  InitialPassword: String;
begin
  AdminPasswordPage := CreateInputQueryPage(
    wpLicense,
    'Account amministratore',
    'Imposta la password iniziale dell''utente admin',
    'Inserisci e conferma la password iniziale per l''utente admin di OnlyBackup.');
  AdminPasswordPage.Add('Password admin:', True);
  AdminPasswordPage.Add('Conferma password:', True);

  InitialPassword := ExpandConstant('{param:AdminPassword|}');
  if InitialPassword <> '' then
  begin
    AdminPasswordPage.Values[0] := InitialPassword;
    AdminPasswordPage.Values[1] := InitialPassword;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = AdminPasswordPage.ID then
  begin
    if Length(AdminPasswordPage.Values[0]) < 8 then
    begin
      MsgBox('La password admin deve contenere almeno 8 caratteri.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    if AdminPasswordPage.Values[0] <> AdminPasswordPage.Values[1] then
    begin
      MsgBox('Le password inserite non coincidono.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure WriteAdminPasswordFile();
var
  PasswordFile: String;
begin
  PasswordFile := ExpandConstant('{tmp}\onlybackup-admin-password.txt');
  if not SaveStringToFile(PasswordFile, AdminPasswordPage.Values[0], False) then
    RaiseException('Impossibile preparare la password admin iniziale.');
end;

function IsNodeCompatible(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(
    ExpandConstant('{cmd}'),
    '/C node -e "const r=[20,19,0]; const v=process.versions.node.split(''.'').map(Number); process.exit(v.some(Number.isNaN) || v[0]<r[0] || (v[0]===r[0] && (v[1]<r[1] || (v[1]===r[1] && v[2]<r[2]))) ? 1 : 0)"',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) and (ResultCode = 0);
end;

function IsDotNet462OrNewerInstalled(): Boolean;
var
  Release: Cardinal;
begin
  Result := False;
  if RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) then
    Result := Release >= 394802;

  if (not Result) and RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) then
    Result := Release >= 394802;
end;

function NeedsDotNet462(): Boolean;
begin
  Result := not IsDotNet462OrNewerInstalled();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsNodeCompatible() then
    Result := 'Prerequisito mancante/non compatibile: Node.js' + #13#10 +
      'Versione minima/supportata: >= 20.19.0' + #13#10 +
      'Motivo: il servizio OnlyBackup Server avvia il server Node.js incluso nel package.' + #13#10 +
      'Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/, riapri PowerShell e rilancia il setup.' + #13#10 +
      'Verifica: node --version';

  if Result = '' then
  begin
    if Length(AdminPasswordPage.Values[0]) < 8 then
      Result := 'La password admin deve contenere almeno 8 caratteri.'
    else if AdminPasswordPage.Values[0] <> AdminPasswordPage.Values[1] then
      Result := 'Le password admin inserite non coincidono.';
  end;
end;

procedure DeinitializeSetup();
begin
  DeleteFile(ExpandConstant('{tmp}\onlybackup-admin-password.txt'));
end;
