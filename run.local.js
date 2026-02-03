const config = require('./config/local.json');

function setEnvVars() {
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = value;
  }
}
setEnvVars();

const { IPC } = require('./lib/ipc');
const { run } = require('./run');
const settings = require('./lib/settings.js');
const ipc = new IPC();
run(settings.readFrom(process.env), ipc);
