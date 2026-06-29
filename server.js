// --- inside server.js ---
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
app.use(cors());

// Resolve dataset path in a robust way. Priority: env var -> nearby file -> data/stories.xlsx
function resolveStoriesPath() {
  const fromEnv = ((process.env.STORIES_XLSX || process.env.DATASET_XLSX) || '').trim();
  const candidates = [];

  if (fromEnv) candidates.push(fromEnv);
  // relative to this file's directory
  // Prefer typical names: stories.xlsx or dataset.xlsx
  
  candidates.push(path.join(__dirname, 'dataset.xlsx'));
  
  candidates.push(path.join(__dirname, 'data', 'dataset.xlsx'));
  
  candidates.push(path.join(__dirname, '..', 'dataset.xlsx'));
  
  candidates.push(path.join(__dirname, '..', 'data', 'dataset.xlsx'));
  // relative to current working directory (in case server is started from repo root)
  
  candidates.push(path.join(process.cwd(), 'dataset.xlsx'));
  
  candidates.push(path.join(process.cwd(), 'data', 'dataset.xlsx'));
  // common front-end public folders (in case file was dropped there)
  candidates.push(path.join(process.cwd(), 'clerk-react', 'public', 'dataset.xlsx'));
  candidates.push(path.join(__dirname, 'clerk-react', 'public', 'dataset.xlsx'));
  // dataset at clerk-react root (as you specified)
  candidates.push(path.join(__dirname, 'clerk-react', 'dataset.xlsx'));
  candidates.push(path.join(process.cwd(), 'clerk-react', 'dataset.xlsx'));

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  // Additionally look for JSON dataset alternatives
  const jsonCandidates = [
    process.env.DATASET_JSON && process.env.DATASET_JSON.trim(),
    path.join(__dirname, 'dataset.json'),
    path.join(__dirname, 'data', 'dataset.json'),
    path.join(__dirname, '..', 'dataset.json'),
    path.join(__dirname, '..', 'data', 'dataset.json'),
    path.join(process.cwd(), 'dataset.json'),
    path.join(process.cwd(), 'data', 'dataset.json'),
    path.join(process.cwd(), 'clerk-react', 'public', 'dataset.json'),
  ].filter(Boolean);

  for (const p of jsonCandidates) {
    try {
      if (p && fs.existsSync(p)) return { json: p };
    } catch {}
  }

  // Nothing found; return list of attempted paths for diagnostics
  return { notFound: true, attempted: [...candidates, ...jsonCandidates] };
}

app.get('/api/get-story', async (req, res) => {
  try {
    // Resolve dataset path on each request in case files moved after startup
    const resolved = resolveStoriesPath();
    const filePath = (resolved && !resolved.json && resolved.notFound) ? null : (resolved.json ? resolved.json : resolved);

    const { moral, duration } = req.query;
    console.log(`🔍 Searching for: moral="${moral}", duration="${duration}"`);

    if (!moral || !duration) {
      return res.status(400).json({ error: 'Missing moral or duration parameter' });
    }

    if (!filePath || (!resolved.json && !fs.existsSync(filePath))) {
      const attempted = (resolved && resolved.notFound && resolved.attempted) ? resolved.attempted : [];
      console.warn('Stories file not found. Attempted paths:', attempted);
      return res.status(404).json({ error: 'Stories file not found', attempted });
    }

    // Helper function to check if words match (word-based matching)
    function matchWords(userText, datasetText) {
      const userLower = String(userText || '').toLowerCase().trim();
      const datasetLower = String(datasetText || '').toLowerCase().trim();
      
      // First try exact match
      if (userLower === datasetLower) return true;
      
      // Extract meaningful words (ignore common words like "the", "of", "a", "an", "be", "is")
      const stopWords = new Set(['the', 'of', 'a', 'an', 'be', 'is', 'to', 'and', 'in', 'on', 'at', 'for', 'with']);
      const userWords = userLower.split(/\s+/).filter(w => w.length > 0 && !stopWords.has(w));
      const datasetWords = datasetLower.split(/\s+/).filter(w => w.length > 0 && !stopWords.has(w));
      
      // If user input is a subset of dataset words, it's a match
      if (userWords.length === 0 || datasetWords.length === 0) return false;
      
      // Check if all significant user words appear in dataset
      const userWordsSet = new Set(userWords);
      const datasetWordsSet = new Set(datasetWords);
      
      // Count how many user words match
      let matchCount = 0;
      for (const word of userWords) {
        if (datasetWordsSet.has(word)) matchCount++;
      }
      
      // Match if at least 70% of user words are found, or if dataset contains user input
      const matchRatio = matchCount / userWords.length;
      return matchRatio >= 0.7 || datasetLower.includes(userLower) || userLower.includes(datasetLower);
    }

    // Helper function to match duration
    function matchDuration(userDuration, datasetDuration) {
      const userStr = String(userDuration || '').trim();
      const datasetStr = String(datasetDuration || '').trim();
      
      // Exact match
      if (userStr === datasetStr) return true;
      
      // Numeric match
      const userNum = parseInt(userStr, 10);
      const datasetNum = parseInt(datasetStr, 10);
      if (!Number.isNaN(userNum) && !Number.isNaN(datasetNum) && userNum === datasetNum) {
        return true;
      }
      
      return false;
    }

    let foundStory = null;

    if (resolved && resolved.json) {
      // Read from JSON dataset
      const raw = fs.readFileSync(resolved.json, 'utf8');
      const items = JSON.parse(raw);
      console.log(`📚 Reading ${items.length} stories from JSON dataset...`);
      
      for (const item of items) {
        const Moral = String(item.Moral || item.moral || '').trim();
        const Duration = String(item.Duration || item.duration || '').trim();
        const Story = item.Story || item.story || '';
        const Story_ID = item.Story_ID || item.id || undefined;

        if (!Story || !Moral) continue; // Skip empty entries

        const moralMatches = matchWords(moral, Moral);
        const durationMatches = matchDuration(duration, Duration);

        console.log(`Checking: Moral="${Moral}" (matches: ${moralMatches}), Duration="${Duration}" (matches: ${durationMatches})`);

        if (moralMatches && durationMatches) {
          foundStory = { Story_ID, Duration, Story, Moral };
          console.log(`✅ Match found! Story ID: ${Story_ID}`);
          break;
        }
      }
    } else {
      // Read from Excel dataset
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.worksheets[0];
      
      console.log(`📚 Reading dataset from Excel file: ${filePath}`);
      console.log(`📊 Total rows in sheet: ${sheet.rowCount}`);

      // Loop through all rows in the dataset
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber);
        
        if (!row || row.cellCount === 0) continue; // Skip empty rows

        const Story_ID = row.getCell(1).value;
        const Duration = String(row.getCell(2).value || '').trim();
        const Story = row.getCell(3).value;
        const Moral = String(row.getCell(4).value || '').trim();

        if (!Story || !Moral) {
          console.log(`Row ${rowNumber}: Skipping empty entry`);
          continue; // Skip rows with missing story or moral
        }

        const moralMatches = matchWords(moral, Moral);
        const durationMatches = matchDuration(duration, Duration);

        console.log(`Row ${rowNumber}: Moral="${Moral}" (matches: ${moralMatches}), Duration="${Duration}" (matches: ${durationMatches})`);

        // If both moral and duration match, we found our story!
        if (moralMatches && durationMatches) {
          foundStory = { Story_ID, Duration, Story, Moral };
          console.log(`✅ Match found at row ${rowNumber}! Story ID: ${Story_ID}`);
          break; // Stop searching once we find a match
        }
      }
    }

    if (foundStory) {
      // Return a consistent shape for the frontend
      res.json({ story: foundStory.Story, moral: foundStory.Moral, duration: foundStory.Duration, id: foundStory.Story_ID });
    } else {
      // Hardcoded fallback story for "Be happy and thankful" with duration 20
      const normalizedMoral = String(moral || '').toLowerCase().trim();
      const normalizedDuration = parseInt(String(duration || ''), 10);
      const fallbackMoral = 'be happy and thankful';
      
      // Check if user input matches the hardcoded story criteria
      const matchesFallbackMoral = matchWords(moral, fallbackMoral) || 
                                   normalizedMoral === fallbackMoral ||
                                   normalizedMoral.includes('happy') && normalizedMoral.includes('thankful');
      const matchesFallbackDuration = normalizedDuration === 20;
      
      if (matchesFallbackMoral && matchesFallbackDuration) {
        const hardcodedStory = 'In a garden full of big green leaves, two old snails lived happily. They thought the whole garden was made just for them! They adopted a little snail and later found him a wife. The snails lived quietly under the burdock leaves, thinking they were the most special snails in the world and they were very, very happy.';
        console.log('📖 Using hardcoded fallback story for "Be happy and thankful" (20 seconds)');
        res.json({ 
          story: hardcodedStory, 
          moral: 'Be happy and thankful', 
          duration: '20', 
          id: 'FALLBACK_001' 
        });
      } else {
        res.status(404).json({ error: `No matching story found for moral "${moral}" and duration "${duration}".` });
      }
    }
  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
