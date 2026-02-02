const fs = require('fs');

function parseItalianDateTime(raw) {
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return { raw };

  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  return {
    raw,
    iso: date.toISOString(),
  };
}

function parseDuration(raw) {
  if (!raw) return { raw };
  const secondsMatch = raw.match(/^(\d+)(s|sec|secondi)?$/i);
  if (secondsMatch) {
    return {
      raw,
      seconds: Number(secondsMatch[1]),
    };
  }
  return { raw };
}

function parseSize(raw) {
  if (!raw) return { raw };
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/);
  if (!match) return { raw };
  const value = Number(match[1].replace(',', '.'));
  const unit = match[2];
  let megabytes = null;
  if (unit.toUpperCase() === 'MB') {
    megabytes = value;
  } else if (unit.toUpperCase() === 'GB') {
    megabytes = value * 1024;
  }
  return { raw, value, unit, megabytes };
}

function parseFiles(raw) {
  if (!raw) return { raw };
  const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return { raw };
  return {
    raw,
    copied: Number(match[1]),
    total: Number(match[2]),
  };
}

function parseSlotLine(raw) {
  if (!raw) return { raw };
  const match = raw.match(/Slot:\s*(\d+),\s*backup trovati:\s*(\d+),\s*cancellati:\s*(\d+)/i);
  if (!match) return { raw };
  return {
    raw,
    slot: Number(match[1]),
    found: Number(match[2]),
    deleted: Number(match[3]),
  };
}

function parseRetentionDetails(lines) {
  const details = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const next = lines[idx + 1];

    if (next && /^(missing|deleted)$/i.test(next)) {
      details.push({ path: line, status: next.toLowerCase() });
      idx += 1;
      continue;
    }

    if (/nessuna cancellazione necessaria/i.test(line)) {
      details.push({ note: line });
      continue;
    }

    details.push({ path: line });
  }

  return details;
}

function readNonEmpty(lines, start) {
  let idx = start;
  while (idx < lines.length && lines[idx].trim() === '') {
    idx += 1;
  }
  return { value: lines[idx] ?? '', next: idx + 1 };
}

function parseReport(text) {
  const lines = text.split(/\r?\n/);
  const runs = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    if (!line.startsWith('BACKUP-')) {
      i += 1;
      continue;
    }

    const run = { job_id: line };

    let res;
    res = readNonEmpty(lines, i + 1);
    run.timestamp = parseItalianDateTime(res.value.trim());
    res = readNonEmpty(lines, res.next);
    run.status = res.value.trim() || null;

    res = readNonEmpty(lines, res.next);
    if (res.value.trim().startsWith('Durata')) {
      res = readNonEmpty(lines, res.next);
      run.duration = parseDuration(res.value.trim());
      res = readNonEmpty(lines, res.next);
    }

    if (res.value.trim() === 'Dimensione:') {
      res = readNonEmpty(lines, res.next);
      run.size = parseSize(res.value.trim());
      res = readNonEmpty(lines, res.next);
    }

    if (res.value.trim() === 'File:') {
      res = readNonEmpty(lines, res.next);
      run.files = parseFiles(res.value.trim());
      res = readNonEmpty(lines, res.next);
    }

    if (res.value.trim() === 'Dest:') {
      res = readNonEmpty(lines, res.next);
      run.destination = res.value.trim();
      res = readNonEmpty(lines, res.next);
    }

    if (res.value.trim() === 'Retention') {
      res = readNonEmpty(lines, res.next);
      const retention = {
        job_label: res.value.trim() || null,
      };
      res = readNonEmpty(lines, res.next);
      retention.slot_summary = parseSlotLine(res.value.trim());

      let cursor = res.next;
      const detailLines = [];
      while (cursor < lines.length) {
        const current = lines[cursor].trim();
        if (current.startsWith('BACKUP-')) break;
        if (current) detailLines.push(current);
        cursor += 1;
      }
      retention.details = parseRetentionDetails(detailLines);
      run.retention = retention;
      i = cursor;
    } else {
      i = res.next;
    }

    runs.push(run);
  }

  return runs;
}

function main() {
  const input = fs.readFileSync(0, 'utf8');
  const parsed = parseReport(input);
  process.stdout.write(JSON.stringify(parsed, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseReport,
  parseItalianDateTime,
  parseRetentionDetails,
};
