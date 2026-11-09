import { config } from '../config';

interface TelegramApiResult {
  ok?: boolean;
  description?: string;
}

function safeDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  return [config.telegram.botToken, config.telegram.webhookSecret]
    .filter(Boolean)
    .reduce((text, secret) => text.split(secret).join('[redacted]'), description);
}

async function callTelegram(
  method: string,
  parameters: Record<string, unknown> = {}
): Promise<TelegramApiResult> {
  const { botToken } = config.telegram;
  if (!botToken) throw new Error('Telegram is not configured.');

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: method === 'getWebhookInfo' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'getWebhookInfo' ? {} : { body: JSON.stringify(parameters) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Telegram API request failed.');
  }
  let result: TelegramApiResult;
  try {
    result = (await response.json()) as TelegramApiResult;
  } catch {
    throw new Error('Telegram API returned an invalid response.');
  }
  if (!response.ok && result.ok !== false) {
    return { ok: false, description: 'Telegram API request failed.' };
  }
  return result;
}

function printResult(result: TelegramApiResult): void {
  const output: TelegramApiResult = { ok: Boolean(result.ok) };
  const description = safeDescription(result.description);
  if (description) output.description = description;
  console.log(JSON.stringify(output));
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!action) throw new Error('Specify set-webhook, webhook-info, or delete-webhook.');

  if (action === 'set-webhook') {
    const publicHost = process.argv[3] ?? config.telegram.publicUrl;
    if (!config.telegram.webhookSecret || !publicHost) {
      throw new Error('Telegram is not configured.');
    }

    let webhookUrl: string;
    try {
      const parsed = new URL(publicHost);
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('invalid public URL');
      }
      webhookUrl = `${parsed.origin}/api/telegram/webhook`;
    } catch {
      throw new Error('Provide a public HTTPS host, for example https://example.com.');
    }

    printResult(
      await callTelegram('setWebhook', {
        url: webhookUrl,
        secret_token: config.telegram.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      })
    );
    return;
  }

  if (action === 'webhook-info') {
    printResult(await callTelegram('getWebhookInfo'));
    return;
  }

  if (action === 'delete-webhook') {
    printResult(await callTelegram('deleteWebhook'));
    return;
  }

  throw new Error('Specify set-webhook, webhook-info, or delete-webhook.');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Telegram API request failed.';
  console.error(safeDescription(message) ?? 'Telegram API request failed.');
  process.exitCode = 1;
});
