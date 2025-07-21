import { Router } from 'express';
import esClient from '../config/database';

import { AICategorizationService } from '../services/AICategorizationService';
import { RAGService } from '../services/RAGService';

import { estypes } from '@elastic/elasticsearch';

const aiCategorizer = new AICategorizationService();
const router = Router();
export function emailRoutes(ragService: RAGService) {
// Enhanced search with folder and account filtering
router.get('/search', async (req, res) => {
  try {
    const { 
      q,           // Text query
      account,     // Filter by account
      folder,      // Filter by specific folder
      folderType,  // Filter by folder type (inbox, sent, spam, etc.)
      from,        // Date from
      to,          // Date to
      size = 50,   // Results per page
      from_offset = 0 // Pagination offset
    } = req.query;

    const must: any[] = [];
    const filter: any[] = [];

    // Text search across subject and content
    if (q) {
      must.push({
        multi_match: {
          query: q,
          fields: ['subject^2', 'raw'],
          fuzziness: 'AUTO'
        }
      });
    }

    // Account filter
    if (account) {
      filter.push({ term: { account } });
    }

    // Folder filter
    if (folder) {
      filter.push({ term: { folder } });
    }

    // Folder type filter (inbox, sent, spam, etc.)
    if (folderType) {
      filter.push({ term: { folderType } });
    }

    // Date range filter
    if (from || to) {
      const dateRange: any = {};
      if (from) dateRange.gte = from;
      if (to) dateRange.lte = to;
      filter.push({ range: { date: dateRange } });
    }

    const searchQuery = {
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter: filter
        }
      },
      sort: [{ date: { order: 'desc' } }],
      size: parseInt(size as string),
      from: parseInt(from_offset as string),
      _source: ['id', 'subject', 'from', 'to', 'date', 'account', 'folder', 'folderType']
    };

    const result = await esClient.search({
      index: 'emails',
      ...searchQuery
    });

    res.json({
      total: result.hits.total,
      emails: result.hits.hits.map((hit: any) => hit._source),
      aggregations: result.aggregations
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get folder statistics
router.get('/stats', async (req, res) => {
  try {
    const { account } = req.query;
    
    const query: any = {
      size: 0,
      aggs: {
        accounts: {
          terms: { field: 'account', size: 10 }
        },
        folders: {
          terms: { field: 'folder', size: 20 }
        },
        folderTypes: {
          terms: { field: 'folderType', size: 10 }
        },
        emailsPerDay: {
          date_histogram: {
            field: 'date',
            calendar_interval: 'day',
            order: { _key: 'desc' }
          }
        }
      }
    };

    if (account) {
      query.query = { term: { account } };
    }

    const result = await esClient.search({
      index: 'emails',
      ...query
    });

    res.json({
      total: result.hits.total,
      stats: result.aggregations
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Stats failed' });
  }
});
router.post('/:id/categorize', async (req, res) => {
  try {
    const { id } = req.params;
    const { _source } = await esClient.get({ index: 'emails', id });
    
    const email = _source as { subject?: string; raw?: string };
    
    const { label } = (email.subject === undefined && email.raw === undefined) ? 
     { label: 'Spam' } : await aiCategorizer.categorizeEmail(email.subject || '', email.raw || '') 
    ;
    await esClient.update({
      index: 'emails',
      id,
      doc: { aiCategory: label }
    });
    res.json({ id, aiCategory: label });
  } catch (e) {
        if (e instanceof Error) {
            res.status(500).json({ error: e.message });
        } else {
            res.status(500).json({ error: String(e) });
        }
    }
});
// Define your Email document shape
interface EmailDoc {
  raw?: string;
  subject?: string;
  from?: string;
  date?: string;
}

router.post('/:id/suggest-reply', async (req, res) => {
  try {
    const { id } = req.params;
console.log('Generating suggested reply for email ID:', id);
    // Explicitly typing the response from Elasticsearch
    const result = await esClient.get<estypes.GetResponse<EmailDoc>>({
      index: 'emails',
      id
    }, { ignore: [404] });
console.log('Elasticsearch result:', result);
    const email = result._source as EmailDoc | undefined;

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Generate suggested reply using RAG
    const suggestion = await ragService.generateSuggestedReply(
      email.raw || email.subject || '',
      email.subject || ''
    );

    res.json({
      emailId: id,
      suggestion,
      email: {
        subject: email.subject ?? '',
        from: email.from ?? '',
        date: email.date ?? ''
      }
    });

  } catch (error) {
    console.error('Error generating suggested reply:', error);
    res.status(500).json({
      error: 'Failed to generate suggested reply',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add new training example
router.post('/training/add-example', async (req, res) => {
  try {
    const { context, keywords, template, metadata } = req.body;

    if (!context || !keywords || !template || !metadata) {
      return res.status(400).json({ 
        error: 'Missing required fields: context, keywords, template, metadata' 
      });
    }

    await ragService.addTrainingExample(context, keywords, template, metadata);
    
    res.json({ 
      message: 'Training example added successfully',
      example: { context, keywords, template, metadata }
    });

  } catch (error) {
    console.error('Error adding training example:', error);
    res.status(500).json({ 
      error: 'Failed to add training example',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get training data statistics
router.get('/training/stats', async (req, res) => {
  try {
    // This would require additional methods in RAGService to get collection stats
    res.json({
      message: 'Training statistics endpoint',
      // Add actual stats here when implemented
    });
  } catch (error) {
    console.error('Error getting training stats:', error);
    res.status(500).json({ error: 'Failed to get training statistics' });
  }
});

  return router;
}