import axios from 'axios';

export class WebhookIntegrationService {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async triggerInterestedEmailWebhook(email: { subject: string; from: string; account: string }) {
    try {
      await axios.post(this.url, {
        event: "InterestedEmail",
        data: email
      });
    } catch (err) {
      console.error("Failed to fire webhook:", err);
    }
  }
}
