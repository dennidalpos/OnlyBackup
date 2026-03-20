# NSSM Local Copy

Questa cartella e il punto standard del repository per una copia locale di `nssm`.

Percorsi supportati dagli script:

```text
tools/nssm/nssm.exe
tools/nssm/win64/nssm.exe
tools/nssm/win32/nssm.exe
```

Uso previsto:

1. Copia qui `nssm.exe` oppure estrai la distribuzione ufficiale mantenendo `win64/` o `win32/`.
2. Esegui `scripts\Install-OnlyBackupServerService.ps1` oppure `scripts\Uninstall-OnlyBackupServerService.ps1` da PowerShell avviata come amministratore.
3. Se vuoi usare un percorso diverso, passa `-NssmPath`.

Nota:

- Il contenuto copiato in questa cartella e ignorato da git.
- Questo file resta versionato per documentare la posizione attesa.
