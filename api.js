import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import Server from './lib/Server.js';

const argv = yargs(hideBin(process.argv))
  .locale('en')
  .option('clientKey', {
    alias: 'k',
    type: 'string',
    description: 'Client API key'
  })
  .option('workers', {
    alias: 'm',
    type: 'number',
    description: 'Maximum concurrent tasks',
    default: 1
  })
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'Server port to listen',
    default: 3000
  })
  .option('host', {
    alias: 'h',
    type: 'string',
    description: 'Server host to listen',
    default: 'localhost'
  })
  .option('timeout', {
    alias: 't',
    type: 'number',
    description: 'Timeout per task in seconds',
    default: 60
  })
  .option('logError', {
    alias: 'l',
    type: 'boolean',
    description: 'Enable error logging',
    default: false
  })
  .argv;

const config = {
    clientKey: argv.clientKey || process.env.CLOUDFREED_CLIENT_KEY,
    maxConcurrentTasks: argv.workers || parseInt(process.env.CLOUDFREED_WORKERS, 10) || 1,
    port: argv.port || parseInt(process.env.CLOUDFREED_PORT, 10) || 3000,
    host: argv.host || process.env.CLOUDFREED_HOST || "localhost",
    timeout: argv.timeout || parseInt(process.env.CLOUDFREED_TASK_TIMEOUT, 10) || 60,
    logError: argv.logError || false,
};

const server = new Server(config);
await server.initialize();
const httpServer = server.listen();

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Shutting down gracefully...');
  await server.stop();
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT signal. Shutting down gracefully...');
  await server.stop();
  httpServer.close(() => {
    process.exit(0);
  });
});
