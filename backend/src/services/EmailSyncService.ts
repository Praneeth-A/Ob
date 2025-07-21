import { ImapFlow, FetchMessageObject } from 'imapflow';
import { getImapAccounts } from '../config/imap';
import esClient from '../config/database';
import { EmailAccount, MailboxInfo } from '../types/EmailAccount';
import { addDays, subDays } from 'date-fns';
import crypto from 'crypto';
import { AICategorizationService } from './AICategorizationService';
import { SlackNotificationService } from './SlackNotificationService';
import { WebhookIntegrationService } from './WebhookIntegrationService';

export class EmailSyncService {
  private clients = new Map<string, ImapFlow>();
  private folderCache = new Map<string, MailboxInfo[]>();
private aiCategorizer = new AICategorizationService();
  
private slack = new SlackNotificationService(process.env.SLACK_WEBHOOK_URL!);
private webhook = new WebhookIntegrationService(process.env.WEBHOOK_URL!);

  async startAll() {
    // Enhanced Elasticsearch mapping for optimal search and categorization
//     try {
//     const exists = await esClient.indices.exists({ index: 'emails' });
//     if (exists) {
//         console.log('Deleting existing "emails" index for fresh start...');
//         await esClient.indices.delete({ index: 'emails' });
//     }
// } catch (error) {
//     console.error('Failed to delete existing "emails" index:', error);
// }
    await esClient.indices.create({
      index: 'emails',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          messageId: { type: 'keyword' },
          subject: { 
            type: 'text',
            analyzer: 'standard',
            fields: {
              keyword: { type: 'keyword' }
            }
          },
          from: { 
            type: 'keyword',
            fields: {
              text: { type: 'text' }
            }
          },
          to: { 
            type: 'keyword',
            fields: {
              text: { type: 'text' }
            }
          },
          date: { type: 'date' },
          account: { type: 'keyword' },
          folder: { type: 'keyword' },
          folderType: { type: 'keyword' }, // inbox, sent, spam, etc.
          raw: { 
            type: 'text',
            analyzer: 'standard'
          },
          // Future AI categorization fields
          aiCategory: { type: 'keyword' },
          aiConfidence: { type: 'float' },
          // Future attachment fields
        //   hasAttachments: { type: 'boolean' },
        //   attachmentCount: { type: 'integer' }
        }
      }
    }, { ignore: [400] });

    const accounts = getImapAccounts();
    for (const account of accounts) {
      this.connectAndSync(account).catch(console.error);
    }
  }

  async connectAndSync(account: EmailAccount) {
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.tls,
      auth: { user: account.username, pass: account.password },
      socketTimeout: 600_000
    });
    
    await client.connect();
    
    // Get all available folders
    const folders = await this.getAllFolders(client, account);
    console.log(`📁 Found ${folders.length} folders for ${account.id}:`, folders.map(f => f.name));
    
    let running = true;

    // Process each folder
    for (const folder of folders) {
      try {
        console.log(`🔄 Processing folder: ${folder.name} (${account.id})`);
        await this.processFolderEmails(client, account, folder);
        
        // Add real-time monitoring for INBOX only (most active folder)
        if (folder.name === 'INBOX') {
          await this.setupRealtimeMonitoring(client, account, folder, running);
        }
      } catch (error) {
        console.error(`❌ Error processing folder ${folder.name}:`, error);
      }
    }

    // Keep-alive and error handling
    this.setupConnectionMaintenance(client, account, running);
    this.clients.set(account.id, client);
    console.log(`✅ Connected IMAP for: ${account.id}`);
  }

  async getAllFolders(client: ImapFlow, account: EmailAccount): Promise<MailboxInfo[]> {
    try {
      const folders = await client.list();
      const processedFolders: MailboxInfo[] = [];

      for (const folder of folders) {
        const folderInfo: MailboxInfo = {
          name: folder.name,
          path: folder.path,
          flags: Array.from(folder.flags || []),  // ✅ Convert Set to Array
 
      specialUse: this.determineSpecialUse(folder.name, Array.from(folder.flags || [])) // Array<string>
};
        processedFolders.push(folderInfo);
      }

      // Cache for future reference
      this.folderCache.set(account.id, processedFolders);
      return processedFolders;
    } catch (error) {
      console.error(`Error listing folders for ${account.id}:`, error);
      return [{ name: 'INBOX', path: 'INBOX', flags: [] }]; // Fallback to INBOX
    }
  }

  determineSpecialUse(folderName: string, flags: string[]): string {
    const lowerName = folderName.toLowerCase();
    
    // Check for Gmail special folders
    if (lowerName.includes('inbox')) return 'inbox';
    if (lowerName.includes('sent') || lowerName.includes('sent mail')) return 'sent';
    if (lowerName.includes('draft')) return 'drafts';
    if (lowerName.includes('spam') || lowerName.includes('junk')) return 'spam';
    if (lowerName.includes('trash') || lowerName.includes('bin')) return 'trash';
    if (lowerName.includes('important')) return 'important';
    if (lowerName.includes('starred')) return 'starred';
    if (lowerName.includes('all mail')) return 'archive';
    
    // Check flags for special use
    if (flags) {
      if (flags.includes('\\Inbox')) return 'inbox';
      if (flags.includes('\\Sent')) return 'sent';
      if (flags.includes('\\Drafts')) return 'drafts';
      if (flags.includes('\\Junk') || flags.includes('\\Spam')) return 'spam';
      if (flags.includes('\\Trash')) return 'trash';
      if (flags.includes('\\Important')) return 'important';
      if (flags.includes('\\All')) return 'archive';
    }
    
    return 'custom'; // Custom user folder
  }

  async processFolderEmails(client: ImapFlow, account: EmailAccount, folder: MailboxInfo) {
    try {
      // Select the folder
      const lock = await client.getMailboxLock(folder.path);
      
      try {
        const since = subDays(new Date(), 30);
        let fetchedCount = 0;
        
        // Fetch emails from this folder
        for await (let msg of client.fetch({ since }, { envelope: true, source: true })) {
          await this.handleEmail(account, msg, folder);
          fetchedCount++;
          
          // Yield control every 25 emails to prevent blocking
          if (fetchedCount % 25 === 0) {
            await new Promise(res => setTimeout(res, 10));
          }
        }
        
        console.log(`📧 Fetched ${fetchedCount} emails from ${folder.name} (${account.id})`);
      } finally {
        lock.release();
      }
    } catch (error) {
      console.error(`Error processing folder ${folder.name}:`, error);
    }
  }

  async setupRealtimeMonitoring(client: ImapFlow, account: EmailAccount, folder: MailboxInfo, running: boolean) {
    client.on('exists', async () => {
      if (!running) return;
      
      const lock = await client.getMailboxLock(folder.path);
      try {
        const status = await client.status(folder.path, { uidNext: true });
        if (typeof status.uidNext !== 'number') return;
        
        const latestUid = status.uidNext - 1;
        if (latestUid === 0) return;
        
        for await (let msg of client.fetch({ uid: latestUid }, { envelope: true, source: true })) {
          await this.handleEmail(account, msg, folder);
        }
      } finally {
        lock.release();
      }
    });
  }

  setupConnectionMaintenance(client: ImapFlow, account: EmailAccount, running: boolean) {
    client.on('close', () => {
      running = false;
      console.warn(`🔌 IMAP connection closed for ${account.id}`);
      setTimeout(() => this.connectAndSync(account), 10_000);
    });

    client.on('error', err => {
      console.error(`❌ IMAP error on ${account.id}:`, err);
    });

    // Keep-alive mechanism
    (async () => {
      while (running) {
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        try {
          await client.noop();
          console.log(`💓 [${account.id}] Sent NOOP keep-alive`);
        } catch (e) {
          console.warn(`⚠️ [${account.id}] NOOP failed, reconnecting...`);
          client.close();
          return;
        }
      }
    })();
  }

  async handleEmail(account: EmailAccount, msg: FetchMessageObject, folder: MailboxInfo) {
    const messageIdRaw = msg.envelope?.messageId;
    if (!messageIdRaw) return;

    const messageIdClean = messageIdRaw.replace(/[<>]/g, '').trim();
    const messageId = crypto.createHash('sha1').update(messageIdClean).digest('hex');

    // Check if already indexed
    try {
      await esClient.get({
        index: 'emails',
        id: messageId
      });
      console.log(`📝 Email exists: ${messageId} (${account.id}/${folder.name})`);
      return;
    } catch (error) {
      if ((error as any)?.meta?.statusCode !== 404) {
        throw error;
      }
    }
const subject = msg.envelope?.subject || '';
    const raw = msg.source ? msg.source.toString() : '';

    // 🟢 AI Categorization with Gemini
    const { label: aiCategory } = await this.aiCategorizer.categorizeEmail(subject, raw);
    console.log(`LAST MESSAGE ${messageId}: ${aiCategory}`);
    // Prepare comprehensive email document
    const emailDoc = {
      id: messageId,
      messageId: messageIdClean,
      subject,
      from: msg.envelope?.from?.map((f: any) => f.address).join(', ') || '',
      to: msg.envelope?.to?.map((t: any) => t.address).join(', ') || '',
      date: msg.envelope?.date || new Date(),
      account: account.id,
      folder: folder.name,
      folderType: folder.specialUse ,
      raw,
      // Future fields
      aiCategory:null,
      aiConfidence: null,
    //   hasAttachments: false,
    //   attachmentCount: 0
    };

    await esClient.index({
      index: 'emails',
      id: messageId,
      document: emailDoc
    });

    console.log(`✅ Indexed: ${emailDoc.subject} (${account.id}/${folder.name})`);
try{
    if (aiCategory === "Interested") {
  await this.slack.sendInterestedEmailNotification({
    subject,
    from: msg.envelope?.from?.map((f: any) => f.address).join(', ') || '',
    account: account.id,
  });
  await this.webhook.triggerInterestedEmailWebhook({
    subject,
    from: msg.envelope?.from?.map((f: any) => f.address).join(', ') || '',
    account: account.id,
  });
}  
console.log(`🔔 Notified interested email: ${emailDoc.subject} (${account.id})`);

}
catch (error) {
  console.error(`❌ Failed to notify interested email: ${error}`);
}
  }
  // Utility method to get folder statistics
  async getFolderStats(accountId?: string) {
    const query: any = {
      size: 0,
      aggs: {
        by_account: {
          terms: { field: 'account' },
          aggs: {
            by_folder: {
              terms: { field: 'folder' }
            },
            by_folder_type: {
              terms: { field: 'folderType' }
            }
          }
        }
      }
    };

    if (accountId) {
      query.query = { term: { account: accountId } };
    }

    const result = await esClient.search({
      index: 'emails',
      ...query
    });

    return result.aggregations;
  }
}
