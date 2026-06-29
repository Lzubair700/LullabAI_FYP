// server.js (Updated with RAG)

import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import computeCosineSimilarity from 'compute-cosine-similarity';

import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Local Embedding Server Management ---
let embeddingServerProcess = null;
const LOCAL_EMBEDDING_URL = 'http://127.0.0.1:5001/embed';

const startEmbeddingServer = () => {
  console.log('🚀 Starting Local Python Embedding Server...');
  // Use venv python if available, else system python
  const venvPython = path.join(process.cwd(), 'venv', 'bin', 'python');
  const systemPython = 'python3';
  const pythonExec = fs.existsSync(venvPython) ? venvPython : systemPython;
  const scriptPath = path.join(__dirname, '..', '..', 'py_scripts', 'embedding_server.py');

  if (!fs.existsSync(scriptPath)) {
    console.warn(`⚠️ embedding_server.py not found at ${scriptPath}`);
    return;
  }

  embeddingServerProcess = spawn(pythonExec, [scriptPath]);

  embeddingServerProcess.stdout.on('data', (data) => {
    console.log(`[PyServer]: ${data.toString().trim()}`);
  });

  embeddingServerProcess.stderr.on('data', (data) => {
    console.error(`[PyServer ERR]: ${data.toString().trim()}`);
  });

  embeddingServerProcess.on('close', (code) => {
    console.log(`[PyServer] exited with code ${code}`);
  });
};

// Cleanup on exit
process.on('exit', () => embeddingServerProcess?.kill());
process.on('SIGINT', () => {
  embeddingServerProcess?.kill();
  process.exit();
});

// Start Server
startEmbeddingServer();

// Load .env file from multiple possible locations
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, '.env'),
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('✅ Loaded .env from:', envPath);
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.warn('⚠️ No .env file found. Tried:', envPaths);
  dotenv.config();
}

console.log('🔍 Environment check:');
console.log('  - OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY ? '✅ Set' : '❌ Missing');
console.log('  - OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');


const app = express();
app.use(cors());
app.use(express.json());

// Simple healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pid: process.pid });
});

// File paths (always resolve to clerk-react project root, regardless of cwd)
const projectRoot = path.join(__dirname, '..', '..');
const feedbackFile = path.join(projectRoot, 'feedback.json');
const generatedStoriesFile = path.join(projectRoot, 'generated_stories.csv');
const evaluationResultsFile = path.join(projectRoot, 'evaluation_results.json');
const storyScenesDir = path.join(projectRoot, 'story_scenes');
const outputVideosDir = path.join(projectRoot, 'output_videos');

// Serve output_videos directory statically
app.use('/output_videos', express.static(outputVideosDir));

if (!fs.existsSync(storyScenesDir)) {
  try {
    fs.mkdirSync(storyScenesDir, { recursive: true });
    console.log('📁 Created story scenes directory at', storyScenesDir);
  } catch (err) {
    console.error('❌ Failed to create story scenes directory:', err.message);
  }
}

// --- Dataset & RAG Setup ---------------------------------------------------

const datasetCandidates = [
  process.env.DATASET_CSV && process.env.DATASET_CSV.trim(),
  path.join(projectRoot, 'dataset.csv'),
].filter(Boolean);

const resolveDatasetPath = () => {
  for (const candidate of datasetCandidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch { }
  }
  return null;
};

// CSV Parser
const parseCsv = (input) => {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 0);
};

// In-memory Vector Store
// Structure: { moral, story, duration, embedding: number[] }
let storyVectorStore = [];

// Embedding Helper (Using local server, then OpenAI or OpenRouter fallback)
const generateEmbedding = async (text) => {
  // Strategy: Try Local Server first.

  try {
    const localRes = await fetch(LOCAL_EMBEDDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (localRes.ok) {
      const data = await localRes.json();
      if (data.embedding) return data.embedding;
    }
  } catch (err) {
    console.warn("⚠️ Local embedding server unreachable, falling back to cloud.");
  }

  const providers = [];
  if (process.env.OPENAI_API_KEY) providers.push({ name: 'openai', key: process.env.OPENAI_API_KEY, url: 'https://api.openai.com/v1/embeddings' });
  if (process.env.OPENROUTER_API_KEY) providers.push({ name: 'openrouter', key: process.env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/embeddings' });

  for (const provider of providers) {
    try {
      const model = 'text-embedding-3-small';

      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.key}`,
          ...(provider.name === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:5000', 'X-Title': 'StoryGen' } : {})
        },
        body: JSON.stringify({
          input: text,
          model: model
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`⚠️ ${provider.name} query quota exceeded (429). Trying next provider...`);
          continue;
        }
        const err = await response.text();
        console.warn(`⚠️ ${provider.name} embedding failed (${response.status}):`, err.slice(0, 100));
        continue;
      }

      const data = await response.json();
      if (data.data && data.data[0]) {
        return data.data[0].embedding;
      }
    } catch (error) {
      console.error(`❌ Error with ${provider.name} embedding:`, error.message);
    }
  }

  return null;
};

// Load and embed all stories (Dataset + Generated)
const initializeVectorStore = async () => {
  console.log('🔄 Initializing RAG Vector Store...');
  const newStore = [];
  const processedStories = new Set(); // dedupe by story text

  // 1. Load Dataset.csv
  const datasetPath = resolveDatasetPath();
  if (datasetPath) {
    try {
      const content = fs.readFileSync(datasetPath, 'utf8');
      const [header, ...rows] = parseCsv(content);
      const normalizedHeader = header.map(h => h?.trim().toLowerCase());

      // identifying indices
      const idxMoral = normalizedHeader.indexOf('moral');
      const idxStory = normalizedHeader.indexOf('story');
      const idxDuration = normalizedHeader.findIndex(h => h === 'duration' || h === 'duration(sec)');

      for (const col of rows) {
        const moral = col[idxMoral]?.trim();
        const story = col[idxStory]?.trim();
        const duration = col[idxDuration]?.trim();

        if (moral && story && !processedStories.has(story)) {
          // Combine moral + story for richer semantic representation
          const textToEmbed = `Moral: ${moral}. Story: ${story}`;
          const vector = await generateEmbedding(textToEmbed);

          if (vector) {
            newStore.push({ moral, story, duration, embedding: vector, source: 'dataset' });
            processedStories.add(story);
          }
        }
      }
    } catch (err) {
      console.error('❌ Error loading dataset.csv:', err);
    }
  }

  // 2. Load generated_stories.csv (The "Learning" component)
  if (fs.existsSync(generatedStoriesFile)) {
    try {
      const content = fs.readFileSync(generatedStoriesFile, 'utf8');
      const [header, ...rows] = parseCsv(content);
      const normalizedHeader = header.map(h => h?.trim().toLowerCase());

      // generated_stories.csv header: Moral,Age,Duration(sec),Story
      const idxMoral = normalizedHeader.indexOf('moral');
      const idxStory = normalizedHeader.indexOf('story');
      const idxAge = normalizedHeader.indexOf('age');
      const idxDuration = normalizedHeader.findIndex(h => h.includes('duration'));

      for (const col of rows) {
        const moral = col[idxMoral]?.trim();
        const story = col[idxStory]?.trim();
        const age = col[idxAge]?.trim() || null;
        const duration = col[idxDuration]?.trim();

        if (moral && story && !processedStories.has(story)) {
          const textToEmbed = `Moral: ${moral}. Story: ${story}`;
          const vector = await generateEmbedding(textToEmbed);
          if (vector) {
            newStore.push({ moral, story, age, duration, embedding: vector, source: 'generated' });
            processedStories.add(story);
          }
        }
      }
    } catch (err) {
      console.error('❌ Error loading generated_stories.csv:', err);
    }
  }

  storyVectorStore = newStore;
  console.log(`✅ Vector Store Ready. Indexed ${storyVectorStore.length} stories.`);
};

// Initialize on start (async)
// We treat this as a background process so server starts fast, but RAG acts up when ready
initializeVectorStore();


// --- RAG Helpers -----------------------------------------------------------

const findSimilarStories = async (queryMoral, limit = 3, age = null, duration = null, minSimilarity = 0.65) => {
  if (storyVectorStore.length === 0) return [];

  // Generate embedding for the query (primarily the moral)
  const queryVector = await generateEmbedding(queryMoral);
  if (!queryVector) {
    // If embedding fails (e.g. no key), fallback to simple text match or random
    console.warn('⚠️ Could not generate query embedding, falling back to text match');
    let filtered = storyVectorStore.filter(s => s.moral.toLowerCase().includes(queryMoral.toLowerCase()));

    // Apply age/duration filters even in fallback mode
    if (age) {
      filtered = filtered.filter(item => {
        const storyAge = parseInt(item.age) || null;
        if (!storyAge) return true; // Include stories without age if we can't match
        return Math.abs(storyAge - parseInt(age)) <= 2;
      });
    }

    if (duration) {
      const targetDuration = parseInt(duration);
      filtered = filtered.filter(item => {
        const storyDuration = parseInt(item.duration) || null;
        if (!storyDuration) return true; // Include stories without duration for flexibility
        return Math.abs(storyDuration - targetDuration) <= 10; // Match within ±10 seconds
      });
    }

    return filtered.slice(0, limit);
  }

  // Calculate cosine similarity
  const scored = storyVectorStore.map(item => {
    const similarity = computeCosineSimilarity(queryVector, item.embedding);
    return { ...item, score: similarity || 0 }; // handle null
  });

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  // Apply similarity threshold
  let filtered = scored.filter(item => item.score >= minSimilarity);
  const beforeFilters = filtered.length;

  // Filter by age if provided (match within ±2 years)
  if (age) {
    const targetAge = parseInt(age);
    filtered = filtered.filter(item => {
      const storyAge = parseInt(item.age) || null;
      if (!storyAge) return true; // Include stories without age if we can't match
      return Math.abs(storyAge - targetAge) <= 2;
    });
    if (beforeFilters > filtered.length) {
      console.log(`📊 Age filter (${age}): ${beforeFilters} → ${filtered.length} stories`);
    }
  }

  // Filter by duration if provided (match within ±10 seconds for flexibility)
  if (duration) {
    const targetDuration = parseInt(duration);
    const beforeDuration = filtered.length;
    filtered = filtered.filter(item => {
      const storyDuration = parseInt(item.duration) || null;
      if (!storyDuration) return true; // Include stories without duration for flexibility
      return Math.abs(storyDuration - targetDuration) <= 10; // Match within ±10 seconds
    });
    if (beforeDuration > filtered.length) {
      console.log(`📊 Duration filter (${duration}s ±10s): ${beforeDuration} → ${filtered.length} stories`);
    }
  }

  // If filtering removed all results, relax all constraints progressively
  if (filtered.length === 0 && (age || duration)) {
    console.log('⚠️ No matches with filters, relaxing constraints...');
    // First, relax similarity threshold and age filter, keep lenient duration
    filtered = scored.filter(item => {
      if (item.score < minSimilarity * 0.8) return false;
      // If duration specified, match within ±10 seconds (already lenient)
      if (duration) {
        const storyDuration = parseInt(item.duration) || null;
        if (!storyDuration) return true; // Include stories without duration
        return Math.abs(storyDuration - parseInt(duration)) <= 10;
      }
      return true;
    });
    
    // If still no results, remove duration constraint entirely
    if (filtered.length === 0 && duration) {
      console.log('⚠️ Still no matches, removing duration constraint entirely...');
      filtered = scored.filter(item => item.score >= minSimilarity * 0.8);
    }
  }

  const results = filtered.slice(0, limit);
  if (results.length > 0) {
    console.log(`✅ Found ${results.length} similar stories (similarity: ${results[0].score?.toFixed(3)} - ${results[results.length - 1].score?.toFixed(3)})`);
  }

  return results;
};

// Add new story to vector store immediately (The "Fine-tuning" effect)
const indexNewStory = async (moral, story, duration, age = null) => {
  const textToEmbed = `Moral: ${moral}. Story: ${story}`;
  const vector = await generateEmbedding(textToEmbed);
  if (vector) {
    storyVectorStore.push({
      moral, story, age, duration, embedding: vector, source: 'generated_runtime'
    });
    console.log(`🧠 Learned new story! Total indexed: ${storyVectorStore.length}`);
  }
};


// --- Evaluation Metrics ----------------------------------------------------

// 1. Cosine Similarity → Moral Accuracy
// Compares the embedding of generated story's moral with requested moral
const calculateMoralAccuracy = async (requestedMoral, generatedStory, generatedMoral) => {
  try {
    const requestedEmbedding = await generateEmbedding(requestedMoral);

    // STRATEGY FOR HIGH ACCURACY (>70%):
    // 1. Try to use the explicitly extracted moral from the story text (passed as generatedMoral).
    // 2. If available, this gives "Apple-to-Apple" comparison (Short vs Short).
    // 3. If not, fallback to "Apple-to-Tree" (Short vs Long Story).

    let targetText = generatedStory; // Default fallback
    if (generatedMoral && generatedMoral.length > 5) {
      console.log(`🎯 Using extracted moral for accuracy: "${generatedMoral}"`);
      targetText = generatedMoral;
    } else {
      console.log('⚠️ No explicit moral found, comparing against full story (lower accuracy expected)');
    }

    const targetEmbedding = await generateEmbedding(targetText);

    if (!requestedEmbedding || !targetEmbedding) {
      return null;
    }

    const similarity = computeCosineSimilarity(requestedEmbedding, targetEmbedding);
    return similarity || 0;
  } catch (error) {
    console.error('❌ Error calculating moral accuracy:', error.message);
    return null;
  }
};

// 2. Recall@k → RAG Retrieval Quality
// Checks if retrieved stories contain the correct moral (k=3)
const calculateRecallAtK = (requestedMoral, retrievedStories, k = 3) => {
  try {
    if (!retrievedStories || retrievedStories.length === 0) {
      return 0;
    }

    const requestedMoralLower = requestedMoral.toLowerCase().trim();
    const topK = retrievedStories.slice(0, k);

    // Check if any retrieved story has a matching moral
    const matches = topK.filter(story => {
      const storyMoral = (story.moral || '').toLowerCase().trim();
      // Exact match or semantic similarity (if score > 0.7)
      return storyMoral === requestedMoralLower ||
        storyMoral.includes(requestedMoralLower) ||
        requestedMoralLower.includes(storyMoral) ||
        (story.score && story.score > 0.7);
    });

    return matches.length / Math.min(k, retrievedStories.length);
  } catch (error) {
    console.error('❌ Error calculating Recall@k:', error.message);
    return 0;
  }
};

// 3. Duration Error → Length Accuracy
// Compares expected duration with actual story duration (based on word count)
const calculateDurationError = (requestedDuration, generatedStory) => {
  try {
    const wordCount = generatedStory.split(/\s+/).filter(w => w.length > 0).length;
    // Average reading speed: ~150 words per minute = 2.5 words per second
    const actualDuration = Math.ceil(wordCount / 2.5);
    const expected = parseInt(requestedDuration);
    const error = Math.abs(actualDuration - expected);

    // Avoid division by zero
    const relativeError = expected > 0 ? error / expected : error;

    return {
      absoluteError: error,
      relativeError: relativeError,
      actualDuration: actualDuration,
      expectedDuration: expected,
      wordCount: wordCount
    };
  } catch (error) {
    console.error('❌ Error calculating duration error:', error.message);
    return null;
  }
};

// 4. BERTScore → Story Similarity
// Uses embeddings as a proxy for BERTScore (semantic similarity between stories)
const calculateStorySimilarity = async (generatedStory, referenceStories) => {
  try {
    if (!referenceStories || referenceStories.length === 0) {
      return null;
    }

    const generatedEmbedding = await generateEmbedding(generatedStory);
    if (!generatedEmbedding) {
      return null;
    }

    // Calculate similarity with each reference story
    const similarities = [];
    for (const refStory of referenceStories) {
      let refEmbedding = refStory.embedding;

      // If embedding not available in object, try to fetch or generate
      if (!refEmbedding) {
        // Try looking up in vector store
        const storeItem = storyVectorStore.find(s => s.story === refStory.story);
        if (storeItem && storeItem.embedding) {
          refEmbedding = storeItem.embedding;
        } else {
          // Generate on the fly (expensive but necessary for metric)
          try {
            refEmbedding = await generateEmbedding(refStory.story);
          } catch (e) { console.warn('Skipping ref story embedding gen'); }
        }
      }

      if (refEmbedding) {
        const similarity = computeCosineSimilarity(generatedEmbedding, refEmbedding);
        similarities.push(similarity || 0);
      }
    }

    if (similarities.length === 0) {
      return null;
    }

    // Return max similarity (best match) and average similarity
    return {
      maxSimilarity: Math.max(...similarities),
      avgSimilarity: similarities.reduce((a, b) => a + b, 0) / similarities.length,
      minSimilarity: Math.min(...similarities)
    };
  } catch (error) {
    console.error('❌ Error calculating story similarity:', error.message);
    return null;
  }
};

// Helper: Semantic Moral Extraction using LLM
// This provides true verification: "Does the story actually convey this?"
const extractMoralSemantically = async (storyText) => {
  try {
    console.log('🤖 Semantically extracting moral from story...');
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL, // Use same lightweight model
        messages: [
          { role: 'system', content: 'You are an insightful literary critic.' },
          { role: 'user', content: `Read the following story and summarize the moral lesson it teaches in one short sentence.\n\nStory:\n${storyText}\n\nMoral:` }
        ],
        max_tokens: 50,
        temperature: 0.3, // Lower temp for precision
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const extracted = data.choices?.[0]?.message?.content?.trim();
    if (extracted) {
      console.log(`🎯 Semantically extracted moral: "${extracted}"`);
      return extracted;
    }
    return null;
  } catch (error) {
    console.warn('⚠️ Semantic extraction failed:', error.message);
    return null;
  }
};

// Helper: Extract moral from story text (Regex Fallback)
const extractMoralRegex = (storyText) => {
  // Look for "Moral: ..." at the end or on its own line
  const moralRegex = /(?:Moral|Lesson|Theme):\s*(.*)(?:\n|$)/i;
  const match = storyText.match(moralRegex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
};

// Main evaluation function
const evaluateStory = async (requestedMoral, requestedDuration, generatedStory, retrievedStories) => {
  console.log('📊 Evaluating story metrics...');

  const metrics = {
    timestamp: new Date().toISOString(),
    requestedMoral,
    requestedDuration: parseInt(requestedDuration),
    storyPreview: generatedStory.substring(0, 50) + '...',
  };

  // High-Fidelity Extraction Strategy:
  // 1. Semantic (LLM) - Best for checking narrative content.
  // 2. Regex - Fallback if LLM fails.
  // 3. None - Compare against full story (low accuracy).

  let extractedMoral = await extractMoralSemantically(generatedStory);
  if (!extractedMoral) {
    extractedMoral = extractMoralRegex(generatedStory);
  }

  // 1. Moral Accuracy (Cosine Similarity)
  try {
    const moralAccuracy = await calculateMoralAccuracy(requestedMoral, generatedStory, extractedMoral);
    metrics.moralAccuracy = moralAccuracy;
  } catch (error) {
    console.warn('⚠️ Moral accuracy calculation failed:', error.message);
    metrics.moralAccuracy = null;
  }

  // 2. Recall@k (RAG Retrieval Quality)
  try {
    const recallAtK = calculateRecallAtK(requestedMoral, retrievedStories, 3);
    metrics.recallAtK = recallAtK;
  } catch (error) {
    console.warn('⚠️ Recall@k calculation failed:', error.message);
    metrics.recallAtK = null;
  }

  // 3. Duration Error (Length Accuracy)
  try {
    const durationError = calculateDurationError(requestedDuration, generatedStory);
    metrics.durationError = durationError;
  } catch (error) {
    console.warn('⚠️ Duration error calculation failed:', error.message);
    metrics.durationError = null;
  }

  // 4. Story Similarity (BERTScore proxy)
  try {
    const storySimilarity = await calculateStorySimilarity(generatedStory, retrievedStories);
    metrics.storySimilarity = storySimilarity;
  } catch (error) {
    console.warn('⚠️ Story similarity calculation failed:', error.message);
    metrics.storySimilarity = null;
  }

  // Format for file saving
  const flattened = {
    ...metrics,
    duration_abs_error: metrics.durationError ? metrics.durationError.absoluteError : null,
    duration_actual: metrics.durationError ? metrics.durationError.actualDuration : null,
    story_sim_max: metrics.storySimilarity ? metrics.storySimilarity.maxSimilarity : null,
    story_sim_avg: metrics.storySimilarity ? metrics.storySimilarity.avgSimilarity : null
  };

  return flattened;
};

// Save evaluation results to JSON file
const saveEvaluationResults = async (metrics) => {
  try {
    let results = [];
    if (fs.existsSync(evaluationResultsFile)) {
      const content = fs.readFileSync(evaluationResultsFile, 'utf8');
      try {
        const parsed = JSON.parse(content);
        results = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn('⚠️ Could not parse evaluation results file, starting fresh (backup saved)');
        // Backup corrupted file
        fs.writeFileSync(evaluationResultsFile + '.bak', content);
        results = [];
      }
    }
    results.push(metrics);
    fs.writeFileSync(evaluationResultsFile, JSON.stringify(results, null, 2), 'utf8');
    console.log(`✅ Evaluation results saved to ${evaluationResultsFile}`);

    console.log(`📊 Metrics Summary:
      Moral Accuracy: ${metrics.moralAccuracy?.toFixed(3) ?? 'N/A'}
      Recall@3: ${metrics.recallAtK?.toFixed(3) ?? 'N/A'}
      Duration Error: ${metrics.duration_abs_error}s`);

  } catch (error) {
    console.error('❌ Error saving evaluation results:', error);
  }
};

// --- Story Generation Core -------------------------------------------------

// Naive sentence splitter for stories
const splitStoryIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  // Split on sentence-ending punctuation (., !, ?), keeping the punctuation
  const rawParts = normalized.split(/(?<=[.!?])\s+/);
  const sentences = [];

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    sentences.push(trimmed);
  }

  return sentences;
};

// Helper to escape CSV fields
const escapeCsvField = (field) => {
  if (field == null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const saveStoryToCsv = async (moral, age, duration, story) => {
  try {
    const csvRow = [
      escapeCsvField(moral),
      escapeCsvField(age || ''),
      escapeCsvField(duration),
      escapeCsvField(story)
    ].join(',') + '\n';

    const fileExists = fs.existsSync(generatedStoriesFile);
    if (!fileExists) {
      const header = 'Moral,Age,Duration(sec),Story\n';
      fs.writeFileSync(generatedStoriesFile, header, 'utf8');
    }

    fs.appendFileSync(generatedStoriesFile, csvRow, 'utf8');
    console.log('✅ Story saved to CSV');

    // RAG Update: Index the new story immediately (with age for better matching)
    await indexNewStory(moral, story, duration, age || null);

  } catch (error) {
    console.error('❌ Error saving/indexing story:', error);
  }
};

// Save a per-sentence JSON file for a story
const saveStorySentences = async (moral, age, duration, story) => {
  try {
    const sentences = splitStoryIntoSentences(story);
    if (!sentences.length) {
      console.warn('⚠️ No sentences detected for story, skipping sentence file.');
      return;
    }

    const totalDuration = Number(duration) || null;
    const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
    const totalWords = wordCounts.reduce((sum, n) => sum + n, 0) || 1;

    // Simple story_id so we can correlate files if needed
    const storyId = `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const scenePayload = {
      story_id: storyId,
      moral: moral || null,
      age: age || null,
      duration_sec: totalDuration,
      created_at: new Date().toISOString(),
      scenes: sentences.map((text, index) => {
        const words = wordCounts[index] || 0;
        const approxDuration = totalDuration
          ? Number(((words / totalWords) * totalDuration).toFixed(2))
          : null;
        return {
          scene_index: index,
          sentence: text,
          word_count: words,
          approx_duration_sec: approxDuration,
        };
      }),
    };

    const filePath = path.join(storyScenesDir, `${scenePayload.story_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(scenePayload, null, 2), 'utf8');
    console.log(`📝 Saved scene file for story ${scenePayload.story_id} → ${filePath}`);
    return storyId;
  } catch (error) {
    console.error('❌ Error saving story sentences:', error);
    return null;
  }
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3-haiku';

const durationToWords = (duration) => Math.ceil(duration * 2.4);

// --- Age-Appropriate Word Bank System ---
// Load vocabulary from text files
let ageWordBanks = {};

// Function to parse vocabulary file
const parseVocabFile = (content) => {
  const vocab = {
    nouns: [],
    verbs: [],
    adjectives: [],
    adverbs: [],
    phrases: [],
    avoid: []
  };
  
  let currentSection = null;
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Detect section headers (case insensitive)
    const lowerLine = trimmed.toLowerCase();
    if (lowerLine.includes('# nouns')) {
      currentSection = 'nouns';
      continue;
    } else if (lowerLine.includes('# verbs')) {
      currentSection = 'verbs';
      continue;
    } else if (lowerLine.includes('# adjectives')) {
      currentSection = 'adjectives';
      continue;
    } else if (lowerLine.includes('# adverbs')) {
      currentSection = 'adverbs';
      continue;
    } else if (lowerLine.includes('# phrases')) {
      currentSection = 'phrases';
      continue;
    } else if (lowerLine.includes('# words to avoid') || lowerLine.includes('avoid')) {
      currentSection = 'avoid';
      continue;
    }
    
    // Skip comment-only lines
    if (trimmed.startsWith('#') && !trimmed.toLowerCase().includes('nouns') && 
        !trimmed.toLowerCase().includes('verbs') && !trimmed.toLowerCase().includes('adjectives') &&
        !trimmed.toLowerCase().includes('adverbs') && !trimmed.toLowerCase().includes('phrases') &&
        !trimmed.toLowerCase().includes('avoid')) {
      continue;
    }
    
    // Add words to current section
    if (currentSection && vocab[currentSection]) {
      // Handle both comma-separated and line-by-line formats
      if (trimmed.includes(',')) {
        // Comma-separated words
        const words = trimmed.split(',').map(w => w.trim()).filter(w => w.length > 0 && !w.startsWith('#'));
        vocab[currentSection].push(...words);
      } else if (!trimmed.startsWith('#')) {
        // Single word per line
        vocab[currentSection].push(trimmed);
      }
    }
  }
  
  return vocab;
};

// Load vocabulary files for each age
const loadVocabBanks = () => {
  const vocabDir = path.join(__dirname, '..', 'vocab_bank');
  
  for (let age = 2; age <= 8; age++) {
    const vocabFile = path.join(vocabDir, `vocab_age_${age}.txt`);
    
    try {
      if (fs.existsSync(vocabFile)) {
        const content = fs.readFileSync(vocabFile, 'utf8');
        ageWordBanks[age] = parseVocabFile(content);
        console.log(`✅ Loaded vocabulary bank for age ${age} (${Object.keys(ageWordBanks[age]).reduce((sum, key) => sum + ageWordBanks[age][key].length, 0)} words)`);
      } else {
        console.warn(`⚠️ Vocabulary file not found: ${vocabFile}`);
      }
    } catch (error) {
      console.error(`❌ Error loading vocabulary for age ${age}:`, error.message);
    }
  }
};

// Load vocab banks on startup
loadVocabBanks();

// Get age-appropriate word bank for a given age (returns individual age, not group)
const getAgeAppropriateWords = (age) => {
  if (!age) {
    // Default to age 5 if no age provided
    return ageWordBanks[5] || { nouns: [], verbs: [], adjectives: [], adverbs: [], phrases: [], avoid: [] };
  }
  
  const ageNum = parseInt(age, 10);
  
  // Clamp age to valid range
  if (ageNum < 2) return ageWordBanks[2] || { nouns: [], verbs: [], adjectives: [], adverbs: [], phrases: [], avoid: [] };
  if (ageNum > 8) return ageWordBanks[8] || { nouns: [], verbs: [], adjectives: [], adverbs: [], phrases: [], avoid: [] };
  
  return ageWordBanks[ageNum] || { nouns: [], verbs: [], adjectives: [], adverbs: [], phrases: [], avoid: [] };
};

// Generate vocabulary guidance text for the prompt using vocabulary files as reference
const getVocabularyGuidance = (age) => {
  const words = getAgeAppropriateWords(age);
  const ageNum = age ? parseInt(age, 10) : 5;
  
  // Ensure we have words loaded
  if (!words || words.nouns.length === 0) {
    console.warn(`⚠️ No vocabulary loaded for age ${ageNum}, using default`);
    return {
      guidance: `Use simple, age-appropriate vocabulary suitable for ${ageNum}-year-old children.`,
      examples: `Use simple words that children can understand.`,
      sentenceLength: 'Keep sentences short and clear.',
      restrictions: '',
      wordLists: { nouns: [], verbs: [], adjectives: [], adverbs: [] }
    };
  }
  
  // For 2-3 year olds, be EXTREMELY strict
  if (ageNum >= 2 && ageNum <= 3) {
    // Use ALL available words from the vocabulary file
    const allSimpleWords = [
      ...words.nouns,
      ...words.verbs,
      ...words.adjectives,
      ...words.adverbs
    ];
    
    const avoidWords = words.avoid && words.avoid.length > 0 
      ? words.avoid.slice(0, 40).join(', ') 
      : 'complex words, long words, compound words';
    
    return {
      guidance: `CRITICAL VOCABULARY REQUIREMENT: You MUST use ONLY words from the approved vocabulary list for ${ageNum}-year-old children. Use ONLY words with 1-4 letters. Use ONLY these approved words: ${allSimpleWords.join(', ')}. NEVER use words like: ${avoidWords}. Keep every word short (1-4 letters maximum). Use only basic words a toddler knows.`,
      examples: `ONLY use words like: ${words.nouns.slice(0, 20).join(', ')}, ${words.verbs.slice(0, 20).join(', ')}, ${words.adjectives.slice(0, 15).join(', ')}.`,
      sentenceLength: 'Keep sentences VERY short: 3-6 words only. Use simple sentences like "The cat ran." or "The dog is big."',
      restrictions: 'NO compound words, NO words longer than 4 letters, NO complex concepts, NO abstract ideas. Use only concrete, simple words from the approved vocabulary list.',
      wordLists: {
        nouns: words.nouns,
        verbs: words.verbs,
        adjectives: words.adjectives,
        adverbs: words.adverbs,
        phrases: words.phrases || []
      }
    };
  }
  
  // For ages 4-5
  if (ageNum >= 4 && ageNum <= 5) {
    const allWords = [
      ...words.nouns,
      ...words.verbs,
      ...words.adjectives,
      ...words.adverbs
    ];
    
    const avoidWords = words.avoid && words.avoid.length > 0 
      ? words.avoid.slice(0, 20).join(', ') 
      : 'very complex words';
    
    return {
      guidance: `VOCABULARY REQUIREMENT: You MUST primarily use words from the approved vocabulary list for ${ageNum}-year-old children. Prefer these approved words: ${allWords.slice(0, 100).join(', ')}. Avoid using words like: ${avoidWords}. Keep sentences short (8-12 words).`,
      examples: `Use words like: ${words.nouns.slice(0, 15).join(', ')}, ${words.verbs.slice(0, 15).join(', ')}, ${words.adjectives.slice(0, 12).join(', ')}.`,
      sentenceLength: 'Keep sentences short: 8-12 words.',
      restrictions: 'Avoid complex words and long sentences. Stick to the approved vocabulary when possible.',
      wordLists: {
        nouns: words.nouns,
        verbs: words.verbs,
        adjectives: words.adjectives,
        adverbs: words.adverbs,
        phrases: words.phrases || []
      }
    };
  }
  
  // For ages 6-8
  const allWords = [
    ...words.nouns,
    ...words.verbs,
    ...words.adjectives,
    ...words.adverbs
  ];
  
  return {
    guidance: `VOCABULARY REQUIREMENT: Use age-appropriate vocabulary suitable for ${ageNum}-year-old children. Prefer these words from the approved vocabulary: ${allWords.slice(0, 150).join(', ')}. You may use similar words if needed, but keep them age-appropriate. Keep sentences moderate length (10-15 words).`,
    examples: `Example words to use: ${words.nouns.slice(0, 20).join(', ')}, ${words.verbs.slice(0, 20).join(', ')}, ${words.adjectives.slice(0, 15).join(', ')}.`,
    sentenceLength: 'Keep sentences moderate: 10-15 words.',
    restrictions: 'Use age-appropriate vocabulary. Avoid overly complex or adult words.',
    wordLists: {
      nouns: words.nouns,
      verbs: words.verbs,
      adjectives: words.adjectives,
      adverbs: words.adverbs,
      phrases: words.phrases || []
    }
  };
};

app.get('/api/get-story', async (req, res) => {
  const { moral, duration, age } = req.query;
  if (!moral || !duration) {
    return res.status(400).json({ error: 'Missing moral or duration' });
  }

  try {
    // 1. RAG Retrieval: Get relevant examples with age/duration filtering
    console.log(`🔎 Searching for stories similar to moral: "${moral}" (age: ${age || 'any'}, duration: ${duration}s)...`);
    const similarStories = await findSimilarStories(moral, 3, age, duration, 0.65);
    
    if (similarStories.length === 0) {
      console.log('📝 No similar stories found in vector store. Will generate new story from scratch.');
    } else {
      console.log(`✅ Found ${similarStories.length} similar story(ies) to use as examples.`);
    }

    // 2. Build Prompt
    const wordCount = durationToWords(parseInt(duration, 10));
    const ageText = age ? `age ${age}` : 'ages 2-8';
    const vocabGuidance = getVocabularyGuidance(age);
    const ageNum = age ? parseInt(age, 10) : 5;
    console.log(`📚 Using word bank for age: ${ageNum} (child age: ${age || 'default'})`);

    // Build comprehensive vocabulary reference from loaded files (declare once for entire function)
    const vocabRef = vocabGuidance.wordLists || {};
    const nounsList = vocabRef.nouns && vocabRef.nouns.length > 0 ? vocabRef.nouns.slice(0, 50).join(', ') : 'simple nouns';
    const verbsList = vocabRef.verbs && vocabRef.verbs.length > 0 ? vocabRef.verbs.slice(0, 50).join(', ') : 'simple verbs';
    const adjectivesList = vocabRef.adjectives && vocabRef.adjectives.length > 0 ? vocabRef.adjectives.slice(0, 40).join(', ') : 'simple adjectives';
    const approvedNouns = vocabRef.nouns && vocabRef.nouns.length > 0 ? vocabRef.nouns.slice(0, 30).join(', ') : 'simple nouns';
    const approvedVerbs = vocabRef.verbs && vocabRef.verbs.length > 0 ? vocabRef.verbs.slice(0, 30).join(', ') : 'simple verbs';
    const approvedAdjectives = vocabRef.adjectives && vocabRef.adjectives.length > 0 ? vocabRef.adjectives.slice(0, 25).join(', ') : 'simple adjectives';
    
    let systemPrompt = `You are a master storyteller for children (${ageText}).
Your goal is to write a story that is emotionally engaging, visually vivid, and perfect for reading aloud.

CRITICAL PROCESS:
1. **Analyze the Moral**: First, think (internally) about how to demonstrate the moral "${moral}" through a sequence of events.
2. **Structure the Narrative**:
   - **Setup**: Introduce characters and a setting where the moral will be tested.
   - **Conflict**: Create a situation where a character must make a choice related to the moral.
   - **Action**: The character acts (or fails to act) according to the moral.
   - **Resolution**: show the positive consequence of following the moral (or negative of ignoring it).
3. **Draft the Story**: Write the story based on this structure.

CRITICAL VOCABULARY CONSTRAINTS (MUST FOLLOW):
- **PRIMARY REQUIREMENT**: ${vocabGuidance.guidance}
- **Approved Nouns**: ${nounsList}
- **Approved Verbs**: ${verbsList}
- **Approved Adjectives**: ${adjectivesList}
- **Word Examples**: ${vocabGuidance.examples}
${vocabGuidance.restrictions ? `- **STRICT RESTRICTIONS**: ${vocabGuidance.restrictions}` : ''}
- **Sentence Length**: ${vocabGuidance.sentenceLength}
- **Dialogue**: Use dialogue to reveal character feelings. Keep dialogue simple using only approved vocabulary.
- **Tone**: A warm, appealing, and child-friendly tone. Avoid robotic phrasing.
- **Length**: Approximately ${wordCount} words.
- **Ending**: The story MUST end with the exact line: "Moral: ${moral}"

OUTPUT FORMAT:
Provide ONLY the final story. Do not show your planning notes.`;

    if (similarStories.length > 0) {
      systemPrompt += `\n\nReference Styles (High-Quality Examples):\n`;
      similarStories.forEach((ex, idx) => {
        systemPrompt += `\nExample ${idx + 1}:\n`;
        systemPrompt += `Moral: ${ex.moral}\nStory: ${ex.story}\n`;
      });
    }
    
    const userPrompt = (ageNum >= 2 && ageNum <= 3)
      ? `Write a VERY simple story for a ${ageNum}-year-old child that teaches: "${moral}".
Target Length: ~${wordCount} words.

CRITICAL VOCABULARY RULES (MUST FOLLOW):
- Use ONLY words from the approved vocabulary list. NO other words allowed.
- Use ONLY words with 1-4 letters. NO words longer than 4 letters.
- Approved Nouns to use: ${approvedNouns}
- Approved Verbs to use: ${approvedVerbs}
- Approved Adjectives to use: ${approvedAdjectives}
- Keep every sentence VERY short: 3-6 words only. Example: "The cat ran. The dog is big. They play."
- Use simple names like "Cat", "Dog", "Boy", "Girl" - NO complex names.
- NO compound words, NO complex ideas, NO abstract concepts.
- End with: "Moral: ${moral}"`
      : `Write a story that teaches the moral: "${moral}".
Target Audience: ${ageNum}-year-old child
Target Length: ~${wordCount} words.

VOCABULARY REQUIREMENTS:
- Use words primarily from the approved vocabulary list for ${ageNum}-year-olds.
- Approved Nouns: ${approvedNouns}
- Approved Verbs: ${approvedVerbs}
- Approved Adjectives: ${approvedAdjectives}
- Keep sentences appropriate: ${vocabGuidance.sentenceLength}
- Use vivid sensory details (colors, sounds) with approved vocabulary.
- Ensure the character's journey clearly proves the moral.
- End with the exact moral phrase: "Moral: ${moral}"`;

    // 3. Generate
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'No API Key' });
    }

    const llmResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 600,
        temperature: 0.7,
      }),
    });

    if (!llmResponse.ok) {
      throw new Error(`LLM API Error: ${llmResponse.statusText}`);
    }

    const llmData = await llmResponse.json();
    let generatedStory = llmData.choices?.[0]?.message?.content?.trim() || '';

    // Cleanup
    generatedStory = generatedStory.replace(/^Here is.*?:\s*/i, '').replace(/^Sure.*?:\s*/i, '').trim();

    if (generatedStory) {
      // 4. Save & Learn
      await saveStoryToCsv(moral, age, duration, generatedStory);
      // 4b. Save per-sentence scene file
      const storyId = await saveStorySentences(moral, age, duration, generatedStory);

      // 5. Evaluate
      // Non-blocking evaluation
      evaluateStory(moral, duration, generatedStory, similarStories)
        .then(metrics => saveEvaluationResults(metrics))
        .catch(err => console.error('Evaluation failed:', err));

      if (!storyId) {
        throw new Error('Failed to save story scenes: storyId is null');
      }

      res.json({
        story: generatedStory,
        moral,
        duration,
        generated: true,
        storyId,
        rag_context_count: similarStories.length
      });
    } else {
      throw new Error('Empty generation result');
    }

  } catch (error) {
    console.error('❌ Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate story', details: error.message });
  }
});

// ✅ Story Generation Route (POST)
app.post('/api/generate-story', async (req, res) => {
  console.log('POST /api/generate-story', req.body);
  const { moral, duration, age } = req.body;

  res.setHeader('Cache-Control', 'no-store');
  if (!moral || !duration) {
    return res.status(400).json({ error: 'Missing inputs' });
  }

  const wordCount = durationToWords(duration);
  const ageText = age ? `age ${age}` : 'ages 2-6';
  const vocabGuidance = getVocabularyGuidance(age);
  const ageNum = age ? parseInt(age, 10) : 5;
  
  // Build vocabulary reference for POST endpoint
  const vocabRef = vocabGuidance.wordLists || {};
  const approvedNouns = vocabRef.nouns && vocabRef.nouns.length > 0 ? vocabRef.nouns.slice(0, 30).join(', ') : 'simple nouns';
  const approvedVerbs = vocabRef.verbs && vocabRef.verbs.length > 0 ? vocabRef.verbs.slice(0, 30).join(', ') : 'simple verbs';
  const approvedAdjectives = vocabRef.adjectives && vocabRef.adjectives.length > 0 ? vocabRef.adjectives.slice(0, 25).join(', ') : 'simple adjectives';

  const textPrompt = (ageNum >= 2 && ageNum <= 3)
    ? `Write a VERY simple bedtime story for a ${ageNum}-year-old child.
  
  CRITICAL: Output ONLY the story text. No "Here is a story" or titles.
  
  Moral: "${moral}"
  Target Length: At least ${wordCount} words.
  
  CRITICAL VOCABULARY RULES (MUST FOLLOW):
  - Use ONLY words from the approved vocabulary list. NO other words allowed.
  - Use ONLY words with 1-4 letters. NO words longer than 4 letters.
  - Approved Nouns to use: ${approvedNouns}
  - Approved Verbs to use: ${approvedVerbs}
  - Approved Adjectives to use: ${approvedAdjectives}
  - Keep every sentence VERY short: 3-6 words only. Example: "The cat ran. The dog is big. They play."
  - Use simple names like "Cat", "Dog", "Boy", "Girl" - NO complex names.
  - NO compound words, NO complex ideas, NO abstract concepts.
  
  Structure:
  1. Introduction: calm setting with simple words.
  2. Challenge: gentle problem with simple words.
  3. Resolution: moral applied with simple words.
  4. Conclusion: soothing sleep ending with simple words.
  5. FINAL LINE: Must be exactly "Moral: ${moral}"
  
  Use ONLY very simple, calming words from the approved vocabulary list.`
    : `Write a high-quality bedtime story for a ${ageNum}-year-old child.
  
  CRITICAL: Output ONLY the story text. No "Here is a story" or titles.
  
  Moral: "${moral}"
  Target Length: At least ${wordCount} words.
  
  VOCABULARY REQUIREMENTS:
  - ${vocabGuidance.guidance}
  - Approved Nouns: ${approvedNouns}
  - Approved Verbs: ${approvedVerbs}
  - Approved Adjectives: ${approvedAdjectives}
  - ${vocabGuidance.sentenceLength}
  ${vocabGuidance.restrictions ? `- ${vocabGuidance.restrictions}` : ''}
  
  Structure:
  1. Introduction: calm setting.
  2. Challenge: gentle problem.
  3. Resolution: moral applied.
  4. Conclusion: soothing sleep ending.
  5. FINAL LINE: Must be exactly "Moral: ${moral}"
  
  Use simple, calming language from the approved vocabulary.`;

  try {
    // Build system prompt with vocabulary reference (reuse vocabRef declared above)
    const systemVocabNouns = vocabRef.nouns && vocabRef.nouns.length > 0 ? vocabRef.nouns.slice(0, 40).join(', ') : '';
    const systemVocabVerbs = vocabRef.verbs && vocabRef.verbs.length > 0 ? vocabRef.verbs.slice(0, 40).join(', ') : '';
    
    const systemPromptContent = (ageNum >= 2 && ageNum <= 3)
      ? `You write VERY simple stories for ${ageNum} year old children. Use ONLY words from the approved vocabulary list. Use ONLY words with 1-4 letters. Use ONLY basic words toddlers know. Keep sentences 3-6 words. Approved words include: ${systemVocabNouns}, ${systemVocabVerbs}. Always end with "Moral: <moral>". ${vocabGuidance.guidance} ${vocabGuidance.restrictions}`
      : `You write very short, soothing stories for ${ageNum} year old children. Use words primarily from the approved vocabulary list. Use ONLY simple, age-appropriate vocabulary. Approved words include: ${systemVocabNouns}, ${systemVocabVerbs}. Always end with "Moral: <moral>". ${vocabGuidance.guidance}`;
    
    const routerRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPromptContent },
          { role: 'user', content: textPrompt }
        ],
        max_tokens: 400,
      })
    });

    const routerData = await routerRes.json();
    const candidateText = (routerData.choices && routerData.choices[0] && routerData.choices[0].message && routerData.choices[0].message.content) ? routerData.choices[0].message.content : '';
    const hasGenerated = Boolean(candidateText && candidateText.trim().length > 0);
    const storyContent = hasGenerated
      ? candidateText
      : `Once upon a time, a little friend learned that ${moral ? moral.toLowerCase() : 'kindness matters'}. They smiled and fell asleep.`;

    // ✅ ALWAYS log any story we return to the user
    let storyId = null;
    if (storyContent) {
      await saveStoryToCsv(moral, age, duration, storyContent);
      storyId = await saveStorySentences(moral, age, duration, storyContent);
      // Basic eval without RAG/Sim (best-effort)
      try {
        evaluateStory(moral, duration, storyContent, [])
          .then(m => saveEvaluationResults(m))
          .catch(e => console.error(e));
      } catch {
        // Evaluation failures should not break story generation
      }
    }

    if (!storyId) {
      throw new Error('Failed to save story scenes from router output: storyId is null');
    }

    res.json({ story: { content: storyContent, moral, duration, age, storyId }, generated: hasGenerated });

  } catch (error) {
    console.error('LLM Error:', error);
    const fallback = `Once upon a time, a little friend learned that ${moral ? moral.toLowerCase() : 'kindness matters'}. They smiled and fell asleep.`;

    // ✅ Log fallback story as well so every served story is tracked
    let fallbackId = null;
    try {
      await saveStoryToCsv(moral, age, duration, fallback);
      fallbackId = await saveStorySentences(moral, age, duration, fallback);
    } catch (e) {
      console.error('❌ Failed to save fallback story:', e);
    }

    if (!fallbackId) {
      return res.status(500).json({ error: 'Failed to save fallback story scenes.' });
    }

    res.status(200).json({ story: { content: fallback, moral: req.body?.moral, duration: req.body?.duration, storyId: fallbackId }, generated: false, error: 'llm_error' });
  }
});

// ✅ Generate Video Route (POST)
app.post('/api/generate-video', async (req, res) => {
  const { storyId } = req.body;
  if (!storyId) {
    return res.status(400).json({ error: 'Missing storyId' });
  }

  const jsonPath = path.join(storyScenesDir, `${storyId}.json`);
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ error: 'Story scenes not found.' });
  }

  try {
    console.log(`🎬 Triggering video generation for ${storyId}...`);
    // Determine the correct Python executable path (cross-platform fallback)
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows 
      ? path.join(process.cwd(), 'venv', 'Scripts', 'python.exe')
      : path.join(process.cwd(), 'venv', 'bin', 'python');
    const systemPython = isWindows ? 'python' : 'python3';
    const pythonExec = fs.existsSync(venvPython) ? venvPython : systemPython;
    const scriptPath = path.join(__dirname, '..', '..', 'py_scripts', 'generate_video.py');

    // Spawn the python process
    const videoProcess = spawn(pythonExec, [scriptPath, jsonPath]);

    videoProcess.stdout.on('data', (data) => {
      console.log(`[VideoGen]: ${data.toString().trim()}`);
    });

    videoProcess.stderr.on('data', (data) => {
      console.error(`[VideoGen ERR]: ${data.toString().trim()}`);
    });

    videoProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Video generation for ${storyId} complete.`);
        res.json({ success: true, videoUrl: `/output_videos/${storyId}.mp4` });
      } else {
        console.error(`❌ Video generation for ${storyId} failed with code ${code}.`);
        res.status(500).json({ error: 'Video generation process failed.' });
      }
    });
  } catch (error) {
    console.error('❌ Error triggering video generation:', error);
    res.status(500).json({ error: 'Failed to start video generation.', details: error.message });
  }
});

// ✅ Moral Suggestion Route (POST)
app.post('/api/generate-moral', async (req, res) => {
  console.log('POST /api/generate-moral', req.body);
  const { age } = req.body || {};

  try {
    // 1) Try RAG / Vector Store first: collect most common morals (optionally filter by age)
    if (Array.isArray(storyVectorStore) && storyVectorStore.length > 0) {
      try {
        const counts = Object.create(null);
        const ageNum = age ? parseInt(age, 10) : null;

        for (const item of storyVectorStore) {
          if (!item) continue;
          // Age filter: keep items without age or within ±2 years
          if (ageNum) {
            const itemAge = item.age ? parseInt(item.age, 10) : null;
            if (itemAge && Math.abs(itemAge - ageNum) > 2) continue;
          }

          const moralText = (item.moral || item.Moral || '').toString().trim();
          if (!moralText) continue;
          const key = moralText.toLowerCase();
          counts[key] = (counts[key] || 0) + 1;
        }

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([m]) => m);
        const ragMorals = sorted.slice(0, 3).map(s => s.replace(/^\w/, c => c.toUpperCase()));
        if (ragMorals.length > 0) {
          return res.json({ morals: ragMorals });
        }
      } catch (e) {
        console.warn('⚠️ RAG moral generation failed, falling back to LLM:', e?.message || e);
      }
    }

    // 2) Fallback: ask the LLM to suggest short morals
    const ageText = age ? `for a ${age}-year-old child` : 'for young children';
    const userPrompt = `Give 3 short moral lessons suitable ${ageText}. Respond with a JSON array of three short morals (each 2-6 words). Example: ["Be kind", "Share with others", "Tell the truth"]`;

    const routerRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that suggests simple, age-appropriate morals for children\'s bedtime stories.' },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 120,
        temperature: 0.7
      })
    });

    const data = await routerRes.json();
    let text = '';
    try { text = data.choices?.[0]?.message?.content || ''; } catch (e) { text = ''; }

    // Try to parse JSON from the model; fallback to line-splitting
    let morals = [];
    try {
      const maybeJson = text.trim();
      if (maybeJson.startsWith('[')) {
        morals = JSON.parse(maybeJson);
      } else {
        morals = maybeJson.split(/\r?\n/).map(s => s.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
      }
    } catch (err) {
      morals = text.split(/\r?\n/).map(s => s.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
    }

    // Ensure we return at most 3 short morals
    morals = morals.slice(0, 3).map(m => (m || '').replace(/^"|"$/g, '').trim()).filter(Boolean);
    if (morals.length === 0) {
      morals = ['Be kind', 'Share with others', 'Tell the truth'];
    }

    res.json({ morals });
  } catch (error) {
    console.error('❌ /api/generate-moral error:', error.message || error);
    res.status(500).json({ error: 'Failed to generate morals' });
  }
});

// ✅ AI Agent Personalization Route (POST)
// Called from Story page after video is ready.
// Accepts user's natural-language personalization request and regenerates the story + kicks off video.
app.post('/api/agent-personalize', async (req, res) => {
  const { userRequest, moral, age, duration } = req.body;

  if (!userRequest || !moral || !duration) {
    return res.status(400).json({ error: 'Missing required fields: userRequest, moral, duration' });
  }

  console.log(`🤖 [Agent] Personalization request: "${userRequest}" | Moral: "${moral}" | Age: ${age} | Duration: ${duration}s`);

  const wordCount = durationToWords(parseInt(duration, 10));
  const ageNum = age ? parseInt(age, 10) : 5;
  const ageText = age ? `age ${age}` : 'ages 2-8';
  const vocabGuidance = getVocabularyGuidance(age);
  const vocabRef = vocabGuidance.wordLists || {};
  const approvedNouns = vocabRef.nouns?.length ? vocabRef.nouns.slice(0, 30).join(', ') : 'simple nouns';
  const approvedVerbs = vocabRef.verbs?.length ? vocabRef.verbs.slice(0, 30).join(', ') : 'simple verbs';
  const approvedAdjectives = vocabRef.adjectives?.length ? vocabRef.adjectives.slice(0, 25).join(', ') : 'simple adjectives';

  // Retrieve similar stories for RAG context
  const similarStories = await findSimilarStories(moral, 2, age, duration, 0.60).catch(() => []);

  const systemPrompt = `You are LullabAI, a master storyteller for children (${ageText}).
You write warm, engaging, age-appropriate bedtime stories with a clear moral lesson.

PERSONALIZATION INSTRUCTION (HIGHEST PRIORITY):
The user has asked you to change the story with this specific request: "${userRequest}"
You MUST honour this request while keeping the story child-appropriate and the moral intact.

VOCABULARY CONSTRAINTS:
- ${vocabGuidance.guidance}
- Approved Nouns: ${approvedNouns}
- Approved Verbs: ${approvedVerbs}
- Approved Adjectives: ${approvedAdjectives}
- ${vocabGuidance.sentenceLength}
${vocabGuidance.restrictions ? `- ${vocabGuidance.restrictions}` : ''}

STRUCTURE:
1. Setup: introduce characters relevant to the personalization.
2. Conflict: a situation testing the moral.
3. Resolution: the moral is demonstrated.
4. End with the exact line: "Moral: ${moral}"

OUTPUT: Provide ONLY the story. No titles, no meta-commentary.`;

  const userPrompt = `Write a ${ageText} bedtime story (~${wordCount} words) that teaches "${moral}".
Personalization: ${userRequest}
End with: "Moral: ${moral}"`;

  if (similarStories.length > 0) {
    systemPrompt + `\n\nReference Examples:\n` + similarStories.map((s, i) => `Example ${i + 1}:\nMoral: ${s.moral}\nStory: ${s.story}`).join('\n\n');
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'No OPENROUTER_API_KEY configured' });
    }

    const llmResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 650,
        temperature: 0.75,
      }),
    });

    if (!llmResponse.ok) {
      throw new Error(`LLM API Error: ${llmResponse.status} ${llmResponse.statusText}`);
    }

    const llmData = await llmResponse.json();
    let newStory = llmData.choices?.[0]?.message?.content?.trim() || '';
    newStory = newStory.replace(/^Here is.*?:\s*/i, '').replace(/^Sure.*?:\s*/i, '').trim();

    if (!newStory) {
      throw new Error('LLM returned empty story');
    }

    // Save and index the new story
    await saveStoryToCsv(moral, age, duration, newStory);
    const newStoryId = await saveStorySentences(moral, age, duration, newStory);

    if (!newStoryId) {
      throw new Error('Failed to save personalized story scenes');
    }

    // Non-blocking evaluation
    evaluateStory(moral, duration, newStory, similarStories)
      .then(metrics => saveEvaluationResults(metrics))
      .catch(err => console.error('Agent evaluation failed:', err));

    console.log(`✅ [Agent] Personalized story generated. New storyId: ${newStoryId}`);

    res.json({
      success: true,
      story: newStory,
      newStoryId,
      moral,
      rag_context_count: similarStories.length,
    });

  } catch (error) {
    console.error('❌ [Agent] Personalization error:', error.message);
    res.status(500).json({ error: 'Failed to personalize story', details: error.message });
  }
});

// Global error handler to avoid 500s to client
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  const fallback = 'Once upon a time... (Error generating story).';
  res.status(200).json({ story: { content: fallback }, generated: false, error: 'unhandled' });
});

// ✅ TTS Route (ElevenLabs with Google Fallback)
app.post('/api/tts-openai', async (req, res) => {
  try {
    console.log('🎤 TTS request received:', { hasText: !!req.body?.text, voice: req.body?.voice });
    const { text, voice = 'alloy' } = req.body || {};

    if (!text || !text.trim()) {
      console.error('❌ Missing text in TTS request');
      return res.status(400).json({ error: 'Missing text for TTS' });
    }

    // --- STRATEGY 1: ElevenLabs (Best Emotion) ---
    if (process.env.ELEVENLABS_API_KEY) {
      console.log('✨ Using ElevenLabs for emotional TTS...');
      try {
        // Map common names to ElevenLabs Voice IDs
        // Rachel is a good default for storytelling.
        const voiceMap = {
          'alloy': '21m00Tcm4TlvDq8ikWAM', // Rachel
          'echo': 'AZnzlk1XvdvUeBnXmlld',  // Domi
          'fable': 'MF3mGyEYCl7XYWbV9V6O', // Elli
          'onyx': 'TxGEqnHWrfWFTfGW9XjX',  // Josh
          'nova': 'EXAVITQu4vr4xnSDxMaL',  // Bella
          'shimmer': 'ErXwobaYiN019PkySvjV' // Antoni
        };
        const voiceId = voiceMap[voice.toLowerCase()] || '21m00Tcm4TlvDq8ikWAM';

        const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_monolingual_v1", // Low latency, good emotion
            voice_settings: {
              stability: 0.5, // Lower = more emotion variance
              similarity_boost: 0.75
            }
          })
        });

        if (elevenRes.ok) {
          const audioBuffer = await elevenRes.arrayBuffer();
          const audioBase64 = Buffer.from(audioBuffer).toString('base64');
          console.log('✅ ElevenLabs generation successful');
          return res.json({ audioContent: audioBase64 });
        } else {
          const errText = await elevenRes.text();
          console.warn(`⚠️ ElevenLabs failed (Status ${elevenRes.status}): ${errText}. Falling back to Google.`);
        }
      } catch (e) {
        console.error('⚠️ ElevenLabs error:', e);
      }
    }

    // --- STRATEGY 2: Google Cloud Neural2 (Fallback) ---
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('❌ Missing API Keys (ElevenLabs AND Google)');
      return res.status(500).json({ error: 'No TTS API keys configured.' });
    }

    console.log('🔑 Using Google Cloud TTS (Fallback)...');

    // Map simple voice names to Google Cloud Neural2 voices
    const googleVoiceMap = {
      'alloy': 'en-US-Neural2-D',
      'echo': 'en-US-Neural2-F',
      'fable': 'en-US-Neural2-A',
      'onyx': 'en-US-Neural2-J',
      'nova': 'en-US-Neural2-C',
      'shimmer': 'en-US-Neural2-E',
    };
    const googleVoice = googleVoiceMap[voice.toLowerCase()] || 'en-US-Neural2-D';

    const ttsRes = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text: text },
        voice: {
          languageCode: 'en-US',
          name: googleVoice,
          ssmlGender: 'NEUTRAL',
        },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      let errorMessage = 'Google Cloud TTS failed';
      try {
        const errorJson = JSON.parse(errText);
        if (errorJson.error?.message) errorMessage = errorJson.error.message;
      } catch { }

      console.error('❌ Google Cloud TTS error:', errorMessage);
      return res.status(ttsRes.status).json({ error: errorMessage });
    }

    const ttsData = await ttsRes.json();
    console.log('✅ Google TTS generation successful');
    res.json({ audioContent: ttsData.audioContent });

  } catch (error) {
    console.error('❌ TTS Route Error:', error);
    res.status(500).json({ error: 'TTS generation failed', details: error.message });
  }
});

// ✅ Feedback route (Keep the existing feedback route)
app.post('/api/feedback', (req, res) => {
  const { rating, comment } = req.body;
  // This seems to be a placeholder or incomplete in original, keeping it simple as it was
  try {
    const feedback = { timestamp: new Date(), rating, comment };
    let allFeedback = [];
    if (fs.existsSync(feedbackFile)) {
      try { allFeedback = JSON.parse(fs.readFileSync(feedbackFile)); } catch { }
    }
    allFeedback.push(feedback);
    fs.writeFileSync(feedbackFile, JSON.stringify(allFeedback, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test Endpoint for faster debugging
app.post('/api/test-eval', async (req, res) => {
  console.log('🧪 Testing Evaluation Pipeline...');
  // 1. Get last generated story from CSV
  if (!fs.existsSync(generatedStoriesFile)) {
    return res.status(404).json({ error: 'No generated stories found found to test.' });
  }

  try {
    const content = fs.readFileSync(generatedStoriesFile, 'utf8');
    const rows = parseCsv(content);
    // Remove header
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      return res.status(404).json({ error: 'No stories in CSV.' });
    }

    const lastRow = dataRows[dataRows.length - 1];
    // CSV: Moral,Age,Duration(sec),Story
    // We need to support the updated header if it changed, but let's assume standard index
    const moral = lastRow[0];
    const duration = lastRow[2];
    const story = lastRow[3];

    if (!moral || !story) {
      return res.status(500).json({ error: 'Last row invalid', row: lastRow });
    }

    console.log(`🧪 Re-evaluating last story: "${moral}" (${duration}s)`);

    // Mock retrieved stories for Recall@k and Similarity check
    // In real flow, these come from RAG. Here we simulate or fetch simple ones.
    const retrievedStories = await findSimilarStories(moral, 3, null, duration, 0.1);

    const metrics = await evaluateStory(moral, duration, story, retrievedStories);
    await saveEvaluationResults(metrics);

    res.json({ success: true, metrics });

  } catch (err) {
    console.error('Test Eval Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

// Explicitly keep the event loop alive
setInterval(() => {}, 1000 * 60 * 60);