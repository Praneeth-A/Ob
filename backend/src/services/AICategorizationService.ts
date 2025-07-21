import axios from 'axios';

const LABELS = [
  'Interested',
  'Meeting Booked',
  'Not Interested',
  'Spam',
  'Out of Office'
];

// Uses Gemini 1.5 Flash public API endpoint 
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

export class AICategorizationService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY!;
  }

  async categorizeEmail(subject: string, body: string): Promise<{ label: string }> {
    const prompt = `
      You are an email assistant. Categorize the following email into exactly one of these categories:
      Interested, Meeting Booked, Not Interested, Spam, Out of Office.
      Only respond with the category name, no explanation.

      Email Subject: "${subject}"
      Email Body (truncated): "${body}"
    `;
    // Gemini expects a structured POST body
    const reqBody = {
      contents: [{
        role: "user",
        parts: [{
          text: prompt
        }]
      }]
    };
    try {
      const response = await axios.post(
        `${API_URL}?key=${this.apiKey}`,
        reqBody,
        { headers: { "Content-Type": "application/json" } }
      );
      // Gemini API response shape:
      const labelRaw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const labelNorm = LABELS.find(l => l.toLowerCase() === labelRaw.trim().toLowerCase()) || 'Out of Office';

      return { label: labelNorm };
    } catch (e: any) {
      console.error("Gemini categorization error:", e?.response?.data || e);
      return { label: 'Spam' };
    }
  }
}
