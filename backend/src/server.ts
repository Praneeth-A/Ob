import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { EmailSyncService } from './services/EmailSyncService';
import {emailRoutes} from './routes/emailRoutes';
import { RAGService } from './services/RAGService';

const ragService = new RAGService();
// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
async function startServer() {
await ragService.initialize();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Email Onebox API'
  });
});
console.log('Health endpoint has been set up.');
// Pass the initialized service to your routes
    app.use('/emails', emailRoutes(ragService));

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Email Onebox API is ready!`);
}).on('error', (err) => {
    console.error('❌ Server error:', err);
});
const server = new EmailSyncService();
server.startAll();
}
startServer().catch(console.error);