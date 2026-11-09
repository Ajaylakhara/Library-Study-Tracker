process.env.NODE_ENV = 'test';
require('./testDatabaseGuard').assertSafeTestDatabase();
