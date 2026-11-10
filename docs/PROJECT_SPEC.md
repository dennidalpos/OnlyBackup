# Project specification

[Italian source](PROJECT_SPEC.it.md)

OnlyBackup is a Windows backup coordinator with a Node.js server/dashboard and .NET Framework agent. Implemented areas include HTTP/API startup, file-based users/settings/state, scheduled/manual jobs, heartbeat/offline alerts, email/provider configuration and an agent filesystem/robocopy engine.

## Components

| Path | Responsibility |
|---|---|
| server/src/server.js | Server startup and composition |
| server/src/api/ | Area-specific HTTP/API routes |
| server/src/storage/ | File-based persistence under dataRoot |
| server/public/ | Dashboard and static browser assets |
| agent/OnlyBackupAgent/ | .NET Framework 4.6.2 service/console agent |
| server/service-wrapper/ | Included Windows service wrapper for Node |
| scripts/ | Setup, service, packaging and validation entrypoints |
| scripts/support/ | Internal helpers and installer definitions |
| tools/wix314-binaries/ | Local WiX 3.14 toolchain |

## Constraints and limits

Windows is the reference platform. Node >=20.19.0 runs the server; MSBuild and the .NET Framework targeting pack build agent/wrapper; WiX 3.14 builds the agent MSI. Inno Setup 6 is optional for server EXE generation.

The distributable server package contains dependencies and operational tools but does not bundle the Node runtime. Configuration comes from config.json or CONFIG_PATH. There is no dedicated relational/cloud database and no Linux/macOS agent.

.github community/dependency configuration now exists; older claims that the directory is absent are obsolete. Actions state is a separate remote observation, not implied by having community files. A checksum for installer payload acquisition is not evidence of backup-content hashing or VSS support.

See [operations](OPERATIONS.md) for supported commands and qualification limits. LICENSE and CREDITS govern distribution.
