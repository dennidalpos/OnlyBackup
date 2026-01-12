#!/bin/bash

# Script di riavvio del server OnlyBackup
# Questo script si occupa di riavviare il processo del server in modo sicuro

echo "===================="
echo "OnlyBackup - Riavvio Server"
echo "===================="
echo ""

# Attendi 2 secondi per permettere alla risposta HTTP di essere inviata
sleep 2

# Trova il PID del processo Node.js OnlyBackup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

# Cerca il processo server.js
PID=$(ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}')

if [ -n "$PID" ]; then
    echo "Processo server trovato (PID: $PID)"
    echo "Invio SIGTERM per shutdown graceful..."
    kill -TERM "$PID"

    # Attendi fino a 10 secondi per la terminazione
    for i in {1..10}; do
        if ! ps -p "$PID" > /dev/null 2>&1; then
            echo "Server terminato correttamente"
            break
        fi
        echo "Attesa terminazione... ($i/10)"
        sleep 1
    done

    # Se ancora in esecuzione, forza la terminazione
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Terminazione forzata..."
        kill -9 "$PID"
        sleep 1
    fi
else
    echo "Nessun processo server in esecuzione"
fi

echo ""
echo "Riavvio del server..."

# Se c'è un service manager (systemd, pm2, etc), usa quello
if command -v systemctl &> /dev/null; then
    # SystemD
    if systemctl list-units --full -all | grep -q "onlybackup.service"; then
        echo "Riavvio tramite systemd..."
        systemctl restart onlybackup.service
        exit 0
    fi
fi

if command -v pm2 &> /dev/null; then
    # PM2
    if pm2 list | grep -q "onlybackup"; then
        echo "Riavvio tramite PM2..."
        pm2 restart onlybackup
        exit 0
    fi
fi

# Avvio diretto con Node.js
echo "Avvio diretto con Node.js..."
cd "$SERVER_DIR"
nohup node src/server.js > /dev/null 2>&1 &
echo "Server riavviato (PID: $!)"

echo ""
echo "Riavvio completato!"
echo "===================="
