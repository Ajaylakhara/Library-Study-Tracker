module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  globalSetup: '<rootDir>/tests/jest.globalSetup.js',
  maxWorkers: 1,
  testTimeout: 30000,
  verbose: true,
};
