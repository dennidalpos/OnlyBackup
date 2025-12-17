const fs = require('fs');
const path = require('path');

const getArg = (name, defaultValue = null) => {
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return defaultValue;
};

const jobId = getArg('--job-id') || getArg('-j');
const policyId = getArg('--policy-id') || getArg('-p');
const clientHostname = getArg('--client') || getArg('-c');
const dataRoot = getArg('--data-root', path.join(__dirname, '..', 'data'));
const enabledFlag = getArg('--enabled');

if (!jobId || !policyId || !clientHostname) {
  console.error('Parametri richiesti: --job-id <ID> --policy-id <ID> --client <hostname>');
  process.exit(1);
}

const job = {
  job_id: jobId,
  policy_id: policyId,
  client_hostname: clientHostname,
  enabled: enabledFlag === null ? true : enabledFlag !== 'false'
};

const jobsDir = path.join(dataRoot, 'state', 'jobs');

if (!fs.existsSync(jobsDir)) {
  fs.mkdirSync(jobsDir, { recursive: true });
}

const jobPath = path.join(jobsDir, `${jobId}.json`);
fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
console.log(`Job creato: ${jobPath}`);
