import dotenv from 'dotenv';
import { EmailAccount } from '../types/EmailAccount';
dotenv.config();

export const getImapAccounts = (): EmailAccount[] => {
  const accounts: EmailAccount[] = [];
  // Repeat for as many accounts as you set in .env
  if (process.env.IMAP1_ID) {
    accounts.push({
      id: process.env.IMAP1_ID!,
      host: process.env.IMAP1_HOST!,
      port: Number(process.env.IMAP1_PORT!),
      username: process.env.IMAP1_USERNAME!,
      password: process.env.IMAP1_PASSWORD!,
      tls: process.env.IMAP1_TLS === 'true',
    });
  }
  if (process.env.IMAP2_ID) {
    accounts.push({
      id: process.env.IMAP2_ID!,
      host: process.env.IMAP2_HOST!,
      port: Number(process.env.IMAP2_PORT!),
      username: process.env.IMAP2_USERNAME!,
      password: process.env.IMAP2_PASSWORD!,
      tls: process.env.IMAP2_TLS === 'true',
    });
  }
  return accounts;
};
