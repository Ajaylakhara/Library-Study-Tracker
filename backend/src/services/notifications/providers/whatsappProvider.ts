import https from 'https';
import { INotificationProvider, ProviderSendResult } from './interface';
import { config } from '../../../config';

/** Meta WhatsApp Cloud API Provider */
export class WhatsappProvider implements INotificationProvider {
  async send(
    to: string,
    templateKey: string,
    message: string,
    vars: Record<string, string | number>
  ): Promise<ProviderSendResult> {
    const { token, phoneId, version } = config.meta;

    // Build template components from vars
    const components = Object.values(vars).length > 0
      ? [
          {
            type: 'body',
            parameters: Object.values(vars).map((v) => ({
              type: 'text',
              text: String(v),
            })),
          },
        ]
      : [];

    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: `91${to}`,
      type: 'template',
      template: {
        name: templateKey.toLowerCase(),
        language: { code: 'en_IN' },
        components,
      },
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'graph.facebook.com',
          path: `/${version}/${phoneId}/messages`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.messages?.[0]?.id) {
                resolve({ id: parsed.messages[0].id });
              } else {
                reject(new Error(`WhatsApp error: ${JSON.stringify(parsed)}`));
              }
            } catch {
              reject(new Error(`WhatsApp parse error: ${data}`));
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
