const { createWhatsAppServer } = require('./app');
const { readConfig } = require('./config');

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  return;
}

const server = createWhatsAppServer(config);
server.listen(config.port, '0.0.0.0', () => {
  console.info(JSON.stringify({
    event: 'whatsapp_webhook_server_listening',
    port: config.port,
    localWebhookUrl: `http://localhost:${config.port}/webhook`,
  }));
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: 'server_shutdown_failed' }));
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
