import { ChromaClient, Collection } from 'chromadb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

interface TrainingData {
  context: string;
  keywords: string[];
  template: string;
  metadata: {
    type: string;
    urgency: string;
    category: string;
  };
}

interface TrainingDataSet {
  job_application_responses: TrainingData[];
  general_responses: TrainingData[];
}

export class RAGService {
  private chromaClient: ChromaClient;
  private genAI: GoogleGenerativeAI;
  private collection?: Collection;
  private trainingData: TrainingDataSet;
  private readonly COLLECTION_NAME = 'email_templates';
  private readonly EMBEDDING_MODEL = 'gemini-embedding-001';
  private readonly GENERATION_MODEL = 'gemini-1.5-flash';

  constructor() {
    this.chromaClient = new ChromaClient({
      path: process.env.CHROMA_HOST || 'http://localhost:8000'
    });
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY1!);
    
    // Load training data
    const dataPath = path.join(process.cwd(), 'data', 'training_data.json');
    this.trainingData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }

  async initialize(): Promise<void> {
    try {
      // Create or get collection
      this.collection = await this.chromaClient.getOrCreateCollection({
        name: this.COLLECTION_NAME,
      });

      // Check if collection is empty and populate if needed
      const count = await this.collection.count();
      if (count === 0) {
        await this.populateVectorDatabase();
      }
      
      console.log('✅ RAG Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize RAG Service:', error);
      throw error;
    }
  }

  private async populateVectorDatabase(): Promise<void> {
    if (!this.collection) throw new Error('Collection not initialized');

    console.log('🔄 Populating vector database with training data...');

    // Combine all training data
    const allData = [
      ...this.trainingData.job_application_responses,
      ...this.trainingData.general_responses
    ];

    // Generate embeddings for all contexts and keywords
    const documents: string[] = [];
    const ids: string[] = [];
    const metadatas: any[] = [];

    for (let i = 0; i < allData.length; i++) {
      const item = allData[i];
      // Create searchable text combining context and keywords
      const searchableText = `${item.context} ${item.keywords.join(' ')}`;
      

      documents.push(searchableText);
      ids.push(`template_${i}`);
      metadatas.push({
        ...item.metadata,
        template: item.template,
        context: item.context,
        keywords: item.keywords.join(',')
      });
    }

    // Generate embeddings using Gemini
    const embeddings = await this.generateEmbeddings(documents);

    // Add to ChromaDB
    await this.collection.add({
      ids,
      documents,
      embeddings,
      metadatas
    });

    console.log(`✅ Added ${documents.length} templates to vector database`);
  }

  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    console.log('Generating embeddings...');
    const model = this.genAI.getGenerativeModel({ model: this.EMBEDDING_MODEL });
    
    try {
      const embeddings: number[][] = [];
      
      // Process in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        for (const text of batch) {
          const result = await model.embedContent(text);
          embeddings.push(result.embedding.values);
        }
        
        // Small delay between batches
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve,100));
        }
      }
      
      return embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw error;
    }
  }

  async generateSuggestedReply(emailContent: string, emailSubject: string = ''): Promise<{
    suggestedReply: string;
    confidence: number;
    matchedTemplate: string;
    reasoning: string;
  }> {
    if (!this.collection) {
      throw new Error('RAG Service not initialized');
    }

    try {
      // Combine email subject and content for context
      const queryText = `${emailSubject} ${emailContent}`.trim();
      
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbeddings([queryText]);
      
console.log('Querying Chroma...');
      // Search for similar templates in vector database
      const results = await this.collection.query({
        queryEmbeddings: queryEmbedding,
        nResults: 3, // Get top 3 matches
        include: ['documents', 'metadatas', 'distances']
      });

      if (!results.documents?.[0]?.length) {
        return this.generateGenericReply(emailContent, emailSubject);
      }

      // Extract the best matching templates
      const matchedTemplates = results.metadatas![0].map((metadata: any, index: number) => ({
        template: metadata.template,
        context: metadata.context,
        type: metadata.type,
        category: metadata.category,
        distance: results.distances![0][index],
        keywords: metadata.keywords.split(',')
      }));

      // Use the best match (lowest distance) as primary template
      const bestMatch = matchedTemplates[0];
      
      // Generate contextual reply using Gemini
      const generatedReply = await this.generateContextualReply(
        emailContent,
        emailSubject,
        matchedTemplates
      );

      return {
        suggestedReply: generatedReply,
        confidence: Math.max(0, 1 - (bestMatch.distance ?? 0)), // Convert distance to confidence
        matchedTemplate: bestMatch.template,
        reasoning: `Matched based on context: "${bestMatch.context}" with ${bestMatch.type} type`
      };

    } catch (error) {
      console.error('Error generating suggested reply:', error);
      return this.generateGenericReply(emailContent, emailSubject);
    }
  }

  private async generateContextualReply(
    emailContent: string, 
    emailSubject: string, 
    matchedTemplates: any[]
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.GENERATION_MODEL });

    const meetingLink = process.env.MEETING_BOOKING_LINK || 'https://cal.com/example';
    const bestTemplate = matchedTemplates[0];

    const prompt = `
You are an AI assistant helping to generate professional email replies. 

Based on the following email, generate a personalized response using the matched template as guidance:

**Original Email Subject:** ${emailSubject}
**Original Email Content:** ${emailContent}

**Matched Template:** ${bestTemplate.template}
**Context:** ${bestTemplate.context}
**Template Type:** ${bestTemplate.type}

**Instructions:**
1. Use the template as inspiration but personalize it for this specific email
2. Maintain a professional but friendly tone
3. Be concise and direct
4. If this is about an interview or job opportunity, show enthusiasm

Generate ONLY the reply text, nothing else:
    `;
console.log('Generating Contextual reply...');
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error with Gemini generation:', error);
      // Fallback to template substitution
      return bestTemplate.template.replace('{meeting_link}', meetingLink);
    }
  }

  private async generateGenericReply(emailContent: string, emailSubject: string): Promise<{
    suggestedReply: string;
    confidence: number;
    matchedTemplate: string;
    reasoning: string;
  }> {
    const model = this.genAI.getGenerativeModel({ model: this.GENERATION_MODEL });
    
    const prompt = `
Generate a brief, professional email reply to the following:

**Subject:** ${emailSubject}
**Email:** ${emailContent}

Keep it concise, professional, and helpful. Generate ONLY the reply text:
    `;
console.log('Generating Generic reply...');
    try {
      const result = await model.generateContent(prompt);
      const reply = result.response.text().trim();
      
      return {
        suggestedReply: reply,
        confidence: 0.5, // Lower confidence for generic replies
        matchedTemplate: 'generic_ai_generated',
        reasoning: 'Generated using AI without specific template match'
      };
    } catch (error) {
      console.error('Error generating generic reply:', error);
      return {
        suggestedReply: 'Thank you for your email. I\'ll review this and get back to you soon.',
        confidence: 0.3,
        matchedTemplate: 'fallback',
        reasoning: 'Fallback response due to generation error'
      };
    }
  }

  // Utility method to add new training data
  async addTrainingExample(
    context: string,
    keywords: string[],
    template: string,
    metadata: { type: string; urgency: string; category: string }
  ): Promise<void> {
    if (!this.collection) throw new Error('Collection not initialized');

    const searchableText = `${context} ${keywords.join(' ')}`;
    const embedding = await this.generateEmbeddings([searchableText]);
    
    const id = `custom_${Date.now()}`;
    
    await this.collection.add({
      ids: [id],
      documents: [searchableText],
      embeddings: embedding,
      metadatas: [{
        ...metadata,
        template,
        context,
        keywords: keywords.join(',')
      }]
    });

    console.log(`✅ Added new training example: ${context}`);
  }
}
