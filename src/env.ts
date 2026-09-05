import { config } from 'dotenv';

// Must be the very first thing this process does. NestJS's static module
// registration (`JwtModule.register()`, etc.) reads `process.env` synchronously
// at `require()` time — before any of our own code runs — so `.env` has to be
// loaded before `main.ts` imports `AppModule`, not from inside a module file.
config();
