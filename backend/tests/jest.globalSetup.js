const mongoose = require('mongoose');
const { assertSafeTestDatabase } = require('./testDatabaseGuard');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  assertSafeTestDatabase();
  const uri = process.env.MONGODB_TEST_URI.trim();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    const seats = Array.from({ length: 70 }, (_, index) => {
      const number = index + 1;
      return {
        updateOne: {
          filter: { number },
          update: {
            $setOnInsert: {
              number,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    await mongoose.connection.collection('seats').bulkWrite(seats, { ordered: true });
  } finally {
    await mongoose.disconnect();
  }
};
