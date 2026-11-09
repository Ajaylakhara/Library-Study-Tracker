import https from 'https';
import { INotificationProvider, ProviderSendResult } from './interface';
import { config } from '../../../config';

/** MSG91 SMS Provider */
export class SmsProvider implements INotificationProvider {
  async send(
    to: string,
    templateKey: string,
    message: string,
    _vars: Record<string, string | number>
  ): Promise<ProviderSendResult> {
    const { authKey, senderId, templates } = config.msg91;
    const templateId = templates[templateKey.toLowerCase() as keyof typeof templates] ?? '';

    const body = JSON.stringify({
      template_id: templateId,
      short_url: '0',
      realTimeResponse: '0',
      recipients: [{ mobiles: `91${to}`, message }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.msg91.com',
          path: '/api/v5/flow/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authkey: authKey,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'success') {
                resolve({ id: parsed.request_id ?? 'unknown' });
              } else {
                reject(new Error(`MSG91 error: ${JSON.stringify(parsed)}`));
              }
            } catch {
              reject(new Error(`MSG91 parse error: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
