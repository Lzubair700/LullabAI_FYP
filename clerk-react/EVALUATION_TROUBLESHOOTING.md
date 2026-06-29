# Evaluation System Troubleshooting

## Issue: No evaluation_results.json file created

### Possible Causes:

1. **No stories generated yet**: Evaluation only runs when a story is generated via `/api/get-story`
   - **Solution**: Generate a story first, then check for the file

2. **Embedding quota exceeded**: If OpenAI/OpenRouter embedding quota is exceeded, some metrics will be null but the file should still be created
   - **Solution**: The system now saves partial results even if embeddings fail

3. **File permissions**: The file might not be created due to permissions
   - **Solution**: Check write permissions in the project directory

## How to Verify Evaluation is Working

### 1. Generate a Story
```bash
# Start the server
npm run server

# In another terminal, generate a story
curl "http://localhost:5000/api/get-story?moral=Kindness&duration=30&age=5"
```

### 2. Check Console Logs
You should see:
```
🔍 Starting evaluation...
📊 Evaluating story metrics...
✅ Evaluation results saved to /path/to/evaluation_results.json
📊 Metrics Summary:
  Moral Accuracy: 0.850 (or N/A if embedding quota)
  Recall@3: 0.667
  Duration Error: 3s
  Story Similarity: 0.780 (or N/A if embedding quota)
✅ Evaluation completed
```

### 3. Check the File
```bash
# Check if file exists
ls -la evaluation_results.json

# View contents
cat evaluation_results.json | jq
```

## Handling Embedding Quota Issues

If you see `⚠️ openai query quota exceeded (429)`, the evaluation will still work but:

- ✅ **Recall@k** - Will work (no embeddings needed)
- ✅ **Duration Error** - Will work (no embeddings needed)
- ❌ **Moral Accuracy** - Will be null (requires embeddings)
- ❌ **Story Similarity** - Will be null (requires embeddings)

The file will still be created with partial results:
```json
{
  "timestamp": "2024-12-08T...",
  "requestedMoral": "Kindness",
  "requestedDuration": 30,
  "storyPreview": "...",
  "moralAccuracy": null,
  "recallAtK": 0.67,
  "durationError": {
    "absoluteError": 3,
    "relativeError": 0.1,
    "actualDuration": 27,
    "expectedDuration": 30,
    "wordCount": 68
  },
  "storySimilarity": null
}
```

## Testing Evaluation Manually

You can test the evaluation functions directly by adding this test endpoint:

```javascript
// Add to server.js for testing
app.get('/api/test-evaluation', async (req, res) => {
  const testStory = "Once upon a time, there was a kind little girl named Lily...";
  const testMoral = "Kindness is important";
  const testDuration = 30;
  const testRetrieved = [
    { moral: "Kindness", story: "A story about kindness", score: 0.85 }
  ];
  
  try {
    const metrics = await evaluateStory(testMoral, testDuration, testStory, testRetrieved);
    await saveEvaluationResults(metrics);
    res.json({ success: true, metrics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Expected Behavior

1. **First story generated**: `evaluation_results.json` is created with 1 entry
2. **Subsequent stories**: File is updated with new entries appended
3. **Embedding failures**: Partial results saved (metrics that don't need embeddings still work)
4. **Complete failures**: Error logged, but story generation still succeeds

## File Location

The evaluation results file is saved at:
```
<project-root>/evaluation_results.json
```

Same directory as `generated_stories.csv`

