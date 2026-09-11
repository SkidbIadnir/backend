// Loaded by jest before each e2e file (see jest-e2e.json). Marks the process
// as a test run so `app.module.ts` keeps schema sync on but turns SQL logging off.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
