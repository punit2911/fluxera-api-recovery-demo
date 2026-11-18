import { createApp } from './src/app.js';

const app = createApp();

app.listen().then((port) => {
  console.log(`Fluxera recovery demo listening on port ${port}`);
});

const shutdown = () => {
  app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
