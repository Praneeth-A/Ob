import { IncomingWebhook } from '@slack/webhook';

export class SlackNotificationService {
  private webhook: IncomingWebhook;

  constructor(webhookUrl: string) {
    this.webhook = new IncomingWebhook(webhookUrl);
  }

  async sendInterestedEmailNotification(email: { subject: string; from: string; account: string }) {
    await this.webhook.send({
      text: `:star2: *Interested Lead!*`,
      attachments: [
        {
          color: "#36a64f",
          fields: [
            { title: "From", value: email.from, short: true },
            { title: "Subject", value: email.subject, short: false },
            { title: "Account", value: email.account, short: true }
          ]
        }
      ]
    });
  }
}
