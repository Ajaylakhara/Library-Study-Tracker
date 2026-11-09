import mongoose from 'mongoose';
import { config } from '../config';

export async function migratePreferredChannel(): Promise<number> {
  const result = await mongoose.connection.collection('users').updateMany(
    {
      $or: [
        { preferredChannel: { $exists: false } },
        { whatsappOptIn: { $exists: true } },
        { smsOptIn: { $exists: true } },
      ],
    },
    [
      {
        $set: {
          preferredChannel: {
            $cond: [
              { $eq: ['$whatsappOptIn', true] },
              'whatsapp',
              {
                $cond: [
                  { $eq: ['$smsOptIn', true] },
                  'sms',
                  'whatsapp',
                ],
              },
            ],
          },
        },
      },
      { $unset: ['whatsappOptIn', 'smsOptIn'] },
    ]
  );
  return result.modifiedCount;
}

if (require.main === module) {
  mongoose
    .connect(config.mongoUri)
    .then(async () => {
      const migrated = await migratePreferredChannel();
      console.log(`Migrated preferredChannel for ${migrated} user(s).`);
    })
    .catch((error: unknown) => {
      console.error('Preferred channel migration failed.');
      throw error;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
    });
}
