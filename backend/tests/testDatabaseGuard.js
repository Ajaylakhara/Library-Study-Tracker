require('dotenv').config();
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

function getTestDatabaseName(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('MONGODB_TEST_URI must be a valid MongoDB URI.');
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
    throw new Error('MONGODB_TEST_URI must use mongodb:// or mongodb+srv://.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName) {
    throw new Error('MONGODB_TEST_URI must include a database name ending in "_test".');
  }

  return databaseName;
}

function assertSafeTestDatabase(env = process.env) {
  if (env.NODE_ENV !== 'test') return;

  const uri = env.MONGODB_TEST_URI?.trim();
  if (!uri) {
    throw new Error(
      'Refusing to run tests: MONGODB_TEST_URI is required. Tests never use MONGODB_URI or MONGO_URI.'
    );
  }

  const databaseName = getTestDatabaseName(uri);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}": MONGODB_TEST_URI database name must end with "_test".`
    );
  }
}

module.exports = { assertSafeTestDatabase, getTestDatabaseName };
