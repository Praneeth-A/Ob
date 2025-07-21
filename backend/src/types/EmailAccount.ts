export interface EmailAccount {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}

export interface MailboxInfo {
  name: string;
  path: string;
  flags: string[];
  specialUse?: string;
}
