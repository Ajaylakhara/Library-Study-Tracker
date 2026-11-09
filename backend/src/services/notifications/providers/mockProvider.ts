import { INotificationProvider, ProviderSendResult } from './interface';
import { v4 as uuidv4 } from 'uuid';

/** Mock provider: logs to console. Default in development. */
export class MockProvider implements INotificationProvider {
  private channel: string;

  constructor(channel: 'SMS' | 'WhatsApp' | 'InApp') {
    this.channel = channel;
  }

  async send(
    to: string,
    templateKey: string,
    message: string,
    vars: Record<string, string | number>
  ): Promise<ProviderSendResult> {
    const id = `mock_${uuidv4()}`;
    console.log(
      `[MOCK ${this.channel}] to=${to} template=${templateKey} id=${id}\n  Message: ${message}\n  Vars: ${JSON.stringify(vars)}`
    );
    return { id };
  }
}
