# Asset E Brand Kit

## Prodotto
Il prodotto si chiama `OnlyBackup`. Il posizionamento attuale nel repository e: sistema centralizzato di backup e restore per client Windows, con server Node.js, dashboard web statica e agent Windows.

## Posizione Asset
Gli asset web versionati sono in:

```text
server\public\assets\brand\
```

Gli asset agent/installer sono in:

```text
agent\OnlyBackupAgent\Assets\
```

## Naming Convention

| File | Uso | Dimensione |
| --- | --- | --- |
| `onlybackup-logo.svg` | Logo sorgente per sfondi scuri | 640x160 viewBox |
| `onlybackup-logo-on-light.svg` | Logo sorgente per README o sfondi chiari | 640x160 viewBox |
| `onlybackup-logo-320x80.png` | Export logo compatto | 320x80 |
| `onlybackup-mark.svg` | Mark compatto usato nella dashboard | 128x128 viewBox |
| `onlybackup-mark-128.png` | Export mark compatto | 128x128 |
| `favicon.ico` | Favicon browser | multi-size 32/192/512 |
| `favicon-32.png` | Favicon PNG | 32x32 |
| `apple-touch-icon.png` | Apple touch icon | 180x180 |
| `onlybackup-icon-192.png` | Web manifest icon | 192x192 |
| `onlybackup-icon-512.png` | Web manifest icon | 512x512 |
| `onlybackup-social-og.svg` | Sorgente Open Graph | 1200x630 viewBox |
| `onlybackup-social-og.png` | Open Graph image | 1200x630 |
| `onlybackup-social-twitter.svg` | Sorgente Twitter/X card | 1200x675 viewBox |
| `onlybackup-social-twitter.png` | Twitter/X card image | 1200x675 |
| `onlybackup-social-post.svg` | Sorgente social square | 1200x1200 viewBox |
| `onlybackup-social-post.png` | Immagine social square | 1200x1200 |
| `OnlyBackupAgent.ico` | Icona eseguibile agent e metadati MSI | multi-size 32/192/512 |
| `OnlyBackupAgent.png` | Export sorgente raster agent | 512x512 |

## Palette E Token
La palette deriva dai token CSS esistenti in `server\public\css\style-foundation.css`:

| Token | Valore | Uso |
| --- | --- | --- |
| `--bg-color` | `#0a0f1c` | Sfondo principale |
| `--bg-dark` | `#0f172a` | Superfici scure |
| `--panel-bg` | `#141b2d` | Pannelli dashboard |
| `--primary-color` | `#60a5fa` | Accento primario |
| `--accent-color` | `#38bdf8` | Accento logo/mark |
| `--text-primary` | `#f8fafc` | Testo principale |
| `--text-secondary` | `#cbd5e1` | Testo secondario |
| `--text-muted` | `#94a3b8` | Testo di supporto |

Font stack gia usato:

```css
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
```

Radius, spacing e ombre restano quelli definiti nei token CSS esistenti (`--space-*`, `--radius-*`, `--shadow-*`). Non e stato introdotto un design system separato.

## Dove Sono Consumati

| Consumatore | Riferimento |
| --- | --- |
| Dashboard e pagine statiche | `server\public\index.html`, `alerts.html`, `server-settings.html`, `email-settings.html` |
| Favicon, Apple touch icon, manifest | head HTML delle pagine statiche |
| Web manifest | `server\public\site.webmanifest` |
| Open Graph e Twitter/X card | meta tag head HTML |
| Mark dashboard | `.brand-mark` e `.loading-mark` |
| Icona eseguibile agent | `agent\OnlyBackupAgent\OnlyBackupAgent.csproj` con `ApplicationIcon` |
| Icona MSI in Programmi e funzionalita | `scripts\support\wix\AgentInstaller.wxs` con `ARPPRODUCTICON` |
| README GitHub-facing | `README.md` con logo relativo |

## Rigenerazione Export Raster

Gli export PNG e ICO sono stati generati con PowerShell e `System.Drawing`, senza aggiungere dipendenze al repository. Se devi rigenerarli su Windows, usa PowerShell dalla root del repository e mantieni le stesse dimensioni e gli stessi nomi file.

Verifica rapida che gli asset referenziati esistano:

```powershell
$paths = @(
  'server\public\assets\brand\favicon.ico',
  'server\public\assets\brand\favicon-32.png',
  'server\public\assets\brand\apple-touch-icon.png',
  'server\public\assets\brand\onlybackup-icon-192.png',
  'server\public\assets\brand\onlybackup-icon-512.png',
  'server\public\assets\brand\onlybackup-mark.svg',
  'server\public\assets\brand\onlybackup-logo.svg',
  'server\public\assets\brand\onlybackup-logo-on-light.svg',
  'server\public\assets\brand\onlybackup-logo-320x80.png',
  'server\public\assets\brand\onlybackup-social-og.png',
  'server\public\assets\brand\onlybackup-social-og.svg',
  'server\public\assets\brand\onlybackup-social-twitter.png',
  'server\public\assets\brand\onlybackup-social-twitter.svg',
  'server\public\assets\brand\onlybackup-social-post.png',
  'server\public\assets\brand\onlybackup-social-post.svg',
  'server\public\site.webmanifest',
  'agent\OnlyBackupAgent\Assets\OnlyBackupAgent.ico'
)
$paths | ForEach-Object {
  if (-not (Test-Path $_)) { throw "Asset mancante: $_" }
}
```

Verifica dimensioni raster principali:

```powershell
Add-Type -AssemblyName System.Drawing
$expectedSizes = @{
  'server\public\assets\brand\favicon-32.png' = '32x32'
  'server\public\assets\brand\apple-touch-icon.png' = '180x180'
  'server\public\assets\brand\onlybackup-icon-192.png' = '192x192'
  'server\public\assets\brand\onlybackup-icon-512.png' = '512x512'
  'server\public\assets\brand\onlybackup-logo-320x80.png' = '320x80'
  'server\public\assets\brand\onlybackup-mark-128.png' = '128x128'
  'server\public\assets\brand\onlybackup-social-og.png' = '1200x630'
  'server\public\assets\brand\onlybackup-social-twitter.png' = '1200x675'
  'server\public\assets\brand\onlybackup-social-post.png' = '1200x1200'
  'agent\OnlyBackupAgent\Assets\OnlyBackupAgent.png' = '512x512'
}
foreach ($item in $expectedSizes.GetEnumerator()) {
  $image = [System.Drawing.Image]::FromFile((Resolve-Path $item.Key).Path)
  try {
    $actual = "$($image.Width)x$($image.Height)"
    if ($actual -ne $item.Value) { throw "$($item.Key): atteso $($item.Value), trovato $actual" }
  }
  finally {
    $image.Dispose()
  }
}
```

## Note Installer
Il repository supporta gia packaging agent tramite WiX 3.14. Per questo e stata integrata solo l'icona MSI `ARPPRODUCTICON`, senza aggiungere shortcut o nuove opzioni UI.
