# Assets and brand kit

[Italian source](ASSETS.it.md)

OnlyBackup's web assets are under server/public/assets/brand. Agent/installer icons are under agent/OnlyBackupAgent/Assets. These are existing product assets, not evidence of a newly captured application screenshot.

## Asset inventory

| Asset | Use / dimensions |
|---|---|
| onlybackup-logo.svg / onlybackup-logo-on-light.svg | Dark/light surfaces, 640x160 viewBox |
| onlybackup-logo-320x80.png | Compact logo, 320x80 |
| onlybackup-mark.svg / onlybackup-mark-128.png | Dashboard mark, 128x128 |
| favicon.ico / favicon-32.png | Browser icon / 32x32 PNG |
| apple-touch-icon.png | 180x180 |
| onlybackup-icon-192.png / onlybackup-icon-512.png | Web manifest icons |
| onlybackup-social-og.svg / .png | Open Graph, 1200x630 |
| onlybackup-social-twitter.svg / .png | Social card, 1200x675 |
| onlybackup-social-post.svg / .png | Square social, 1200x1200 |
| OnlyBackupAgent.ico / .png | Agent executable/MSI icon / 512x512 raster source |

## Existing design tokens

The dashboard uses server/public/css/style-foundation.css. Key tokens include bg-color #0a0f1c, bg-dark #0f172a, panel-bg #141b2d, primary-color #60a5fa, accent-color #38bdf8 and the existing text/spacing/radius/shadow tokens. The system font stack starts with the platform UI fonts and Segoe UI. No separate design system is introduced by documentation.

## Consumers and verification

The dashboard, alerts, server settings and email settings pages use the brand assets and favicon/meta references. site.webmanifest references app icons; the dashboard uses brand-mark/loading-mark classes. The agent project declares ApplicationIcon and the WiX AgentInstaller.wxs uses ARPPRODUCTICON. README uses the light-background logo.

The original raster exports were generated with PowerShell/System.Drawing. Preserve names, dimensions and source/consumer links if regenerating. Asset existence and dimensions can be checked with Test-Path and System.Drawing.Image; these checks do not prove screenshot provenance or product runtime behavior. The detailed original size-check examples remain in the linked Italian source.

The agent MSI uses its existing icon and does not add desktop shortcut options. See [operations](OPERATIONS.md) and [script inventory](../scripts/script.md).
