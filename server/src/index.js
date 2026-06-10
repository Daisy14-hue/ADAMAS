'use strict';

const { createServer } = require('./server');

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const { server } = createServer({ corsOrigin: CORS_ORIGIN });

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ADAMAS realtime server listening on http://localhost:${PORT}`);
});
