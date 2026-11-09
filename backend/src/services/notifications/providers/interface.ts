/** Provider interface that all SMS/WhatsApp providers must implement */
export interface ProviderSendResult {
  id: string;
}

export interface INotificationProvider {
  send(
    to: string,
    templateKey: string,
    message: string,
    vars: Record<string, string | number>
  ): Promise<ProviderSendResult>;
}
