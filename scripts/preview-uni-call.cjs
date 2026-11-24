'use strict';

// Local development preview. Exits by closing and removing its temporary
// fixture. The application directory's database, dotenv and uploads are absent.
const { startFixture } = require('../test/fixtures/uni-call-server.cjs');

startFixture({ web: true }).then(fixture => {
  console.log('Uni Call isolated preview:', fixture.url);
  console.log('Register two synthetic accounts in separate tabs or browser profiles, then open a private chat.');
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    try { await fixture.close(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
