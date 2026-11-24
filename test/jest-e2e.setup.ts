// Loaded by jest before each e2e file (see jest-e2e.json). Marks the process
// as a test run so `app.module.ts` turns SQL logging off. The schema comes from
// the migrations, which the app runs when each suite boots it.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
