process.env.NODE_ENV = 'test';
// Tests never need the real secret; this keeps them runnable without a JWT_SECRET in the environment.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-not-for-production-use-0123456789';
require('./testDatabaseGuard').assertSafeTestDatabase();
