# Evaluation Metrics Implementation

## Overview

The system now automatically evaluates each generated story using 4 key metrics and saves the results to `evaluation_results.json`.

## Metrics Implemented

### 1. **Cosine Similarity → Moral Accuracy**
- **What it measures**: How well the generated story's moral matches the requested moral
- **How it works**: 
  - Generates embeddings for both requested and generated morals
  - Calculates cosine similarity between embeddings
  - Returns value between 0-1 (higher = better match)
- **Range**: 0.0 to 1.0
- **Ideal**: > 0.8

### 2. **Recall@k → RAG Retrieval Quality**
- **What it measures**: Whether the RAG system retrieved relevant stories (k=3)
- **How it works**:
  - Checks if any of the top 3 retrieved stories match the requested moral
  - Considers exact matches, substring matches, or high similarity scores (>0.7)
  - Returns ratio of matches found (0-1)
- **Range**: 0.0 to 1.0
- **Ideal**: > 0.67 (at least 2 out of 3 stories match)

### 3. **Duration Error → Length Accuracy**
- **What it measures**: How close the actual story duration is to the requested duration
- **How it works**:
  - Calculates word count of generated story
  - Estimates actual duration (words ÷ 2.5 words/second)
  - Computes absolute and relative error
- **Returns**:
  - `absoluteError`: Difference in seconds
  - `relativeError`: Percentage error
  - `actualDuration`: Estimated duration
  - `expectedDuration`: Requested duration
  - `wordCount`: Number of words
- **Ideal**: Absolute error < 5 seconds

### 4. **BERTScore → Story Similarity**
- **What it measures**: Semantic similarity between generated story and reference stories
- **How it works**:
  - Uses embeddings as a proxy for BERTScore
  - Compares generated story embedding with retrieved reference story embeddings
  - Calculates cosine similarity for each reference
- **Returns**:
  - `maxSimilarity`: Best match score
  - `avgSimilarity`: Average similarity across all references
  - `minSimilarity`: Worst match score
- **Range**: 0.0 to 1.0
- **Ideal**: Max similarity > 0.7

## Results File Structure

Results are saved to `evaluation_results.json` with the following structure:

```json
[
  {
    "timestamp": "2024-12-08T10:30:00.000Z",
    "requestedMoral": "Kindness is important",
    "requestedDuration": 30,
    "storyPreview": "Once upon a time...",
    "moralAccuracy": 0.85,
    "recallAtK": 0.67,
    "durationError": {
      "absoluteError": 3,
      "relativeError": 0.1,
      "actualDuration": 27,
      "expectedDuration": 30,
      "wordCount": 68
    },
    "storySimilarity": {
      "maxSimilarity": 0.78,
      "avgSimilarity": 0.72,
      "minSimilarity": 0.65
    }
  }
]
```

## How It Works

1. **Story Generation**: When a story is generated via `/api/get-story`
2. **Automatic Evaluation**: After saving to CSV, metrics are calculated
3. **Results Storage**: Metrics are appended to `evaluation_results.json`
4. **Non-Blocking**: Evaluation errors don't fail the story generation request

## Integration Points

The evaluation is automatically triggered in:
- `app.get('/api/get-story')` - Main story generation endpoint
- Called after `saveStoryToCsv()` completes
- Uses `similarStories` from RAG retrieval for metrics

## Usage

### Viewing Results

```bash
# View evaluation results
cat evaluation_results.json | jq

# Get latest evaluation
cat evaluation_results.json | jq '.[-1]'

# Calculate average moral accuracy
cat evaluation_results.json | jq '[.[].moralAccuracy] | add / length'

# Find stories with best recall@k
cat evaluation_results.json | jq '.[] | select(.recallAtK > 0.8)'
```

### Analyzing Performance

```bash
# Average metrics across all stories
cat evaluation_results.json | jq '{
  avgMoralAccuracy: ([.[].moralAccuracy] | add / length),
  avgRecallAtK: ([.[].recallAtK] | add / length),
  avgDurationError: ([.[].durationError.absoluteError] | add / length),
  avgStorySimilarity: ([.[].storySimilarity.maxSimilarity] | add / length)
}'
```

## Metric Interpretation

### Moral Accuracy (Cosine Similarity)
- **> 0.8**: Excellent moral alignment
- **0.6-0.8**: Good moral alignment
- **< 0.6**: Poor moral alignment

### Recall@k
- **1.0**: All 3 retrieved stories match (perfect)
- **0.67**: 2 out of 3 stories match (good)
- **0.33**: 1 out of 3 stories match (acceptable)
- **0.0**: No relevant stories retrieved (poor)

### Duration Error
- **< 3 seconds**: Excellent length accuracy
- **3-5 seconds**: Good length accuracy
- **5-10 seconds**: Acceptable length accuracy
- **> 10 seconds**: Poor length accuracy

### Story Similarity (BERTScore proxy)
- **> 0.8**: Very similar to reference stories
- **0.6-0.8**: Moderately similar
- **< 0.6**: Different from reference stories

## Notes

- Evaluation runs asynchronously and doesn't block story generation
- If evaluation fails, the story is still saved (non-blocking)
- Results accumulate over time, allowing trend analysis
- All metrics use existing infrastructure (embeddings, vector store)

## Future Enhancements

Potential improvements:
1. Real BERTScore implementation (requires Python bridge)
2. Per-metric thresholds and alerts
3. Dashboard for visualizing metrics over time
4. Automatic retraining triggers based on metrics
5. A/B testing different RAG configurations

