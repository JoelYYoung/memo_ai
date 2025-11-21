# Memo AI Plugin for Obsidian

An Obsidian plugin that uses AI-powered chunk extraction and review with the SM2 spaced repetition algorithm to help you memorize your notes.

## Features

### 🤖 AI-Powered Chunk Extraction
- **Intelligent Extraction**: Automatically extracts knowledge chunks from your notes using Large Language Models (LLM)
- **Incremental Updates**: When you modify a note, the plugin intelligently updates existing chunks:
  - **Keep**: Preserves chunks that remain unchanged
  - **Modify**: Updates chunks with changed content (with minor/moderate/major update levels)
  - **Delete**: Removes chunks for content that no longer exists
  - **Create**: Adds new chunks for new content
- **Smart Content Analysis**: LLM understands context and semantic meaning, not just text matching

<div align="center">
  <img src="./docs/chunks.jpg" width="100%" >
</div>

### 🎯 Smart Push System with SM2 Algorithm
- **SM2 Spaced Repetition**: Implements the proven SuperMemo 2 algorithm for optimal review scheduling
- **Adaptive Scheduling**: Review intervals automatically adjust based on your performance
- **Importance Multiplier**: High-importance chunks are reviewed more frequently
- **Familiarity Tracking**: Weighted average of past grades (0.0-1.0) tracks your mastery level
- **Intelligent Scoring**: Chunks are scored based on:
  - Importance level (low, medium, high)
  - Familiarity score (how well you know it)
  - Due date (past due chunks get priority)
- **Automatic Scheduling**: Top-scoring chunks are automatically scheduled for review
- **Configurable Threshold**: Set a minimum score threshold for push recommendations
- **Auto Cleanup**: Expired and completed pushes are automatically removed

<div align="center">
 <img src="./docs/push_1.jpg" width="50%" >
</div>

### 💬 Interactive Review System
- **AI Conversation Evaluation**: 
  - Engage in conversations with AI to evaluate your understanding
  - AI generates relevant questions based on chunk content
  - Adaptive responses and feedback
  - End conversations early to get immediate AI evaluation
  - Automatic grading (0-5 scale)
- **Manual Grading**:
  - Simple and intuitive 5-star rating system
  - Quick evaluation without AI interaction
- **Flexible Workflow**: Choose between AI conversation or manual grading for each push
- **Tabbed Interface**: Switch between manual and AI evaluation modes

<div align="center">
<img src="./docs/push_2.jpg" width="33%" ><img src="./docs/push_3.jpg" width="32.5%" >
</div>

### 🔧 Chunk Management
- **Importance Control**: Set importance level (1-3 stars) for each chunk
- **Review Toggle**: Enable/disable review for specific chunks
- **Chunk Deletion**: Remove unwanted chunks
- **Automatic Cleanup**: Chunks for deleted notes are automatically removed
- **Detailed Metrics**: View creation date, familiarity score, review interval, repetition count, and chunk score

## Installation

### Manual Installation

1. Download the latest release from the [Releases](../../releases) page
2. Extract the plugin folder to your Obsidian vault's `.obsidian/plugins/` directory
3. Open Obsidian and go to **Settings → Community Plugins**
4. Enable the **Memo AI** plugin

### Development Installation

1. Clone or copy this repository to `.obsidian/plugins/ai_notebook_plugin/`
2. Open a terminal in the plugin directory
3. Run `npm install` to install dependencies
4. Run `npm run build` to build the plugin
5. Enable the plugin in Obsidian settings

## Usage

### Getting Started

1. **Configure LLM Settings**: Go to **Settings → Memo AI → LLM Settings** and enter your API key
   - Supports OpenAI API and compatible APIs (e.g., Alibaba Cloud DashScope)
   - Configure API base URL, model name, and timeout

2. **Extract Chunks from a Note**:
   - Open a note you want to review
   - Use command palette (Cmd/Ctrl + P) and run **"Extract chunks from current note"**
   - Or open **"Note Chunks"** view and click **"Extract Chunks"**
   - The plugin will use LLM to intelligently extract knowledge chunks

3. **Review Chunks**:
   - Open **"Push Center"** view (automatically opens on plugin load)
   - Click **"Refresh Pushes"** to schedule new pushes
   - Select a push to review
   - Choose between AI conversation or manual grading

### Note Chunks View

The **Note Chunks** view shows all chunks extracted from the current note:

- **Extract Chunks**: Extract or update chunks from the current note
- **Importance Rating**: Click stars to set importance (1-3 stars)
- **Review Toggle**: Toggle whether a chunk needs review
- **Delete**: Remove a chunk
- **View Details**: See familiarity score, review interval, repetition count, and chunk score

### Push Center

The **Push Center** is your main review interface:

- **Push List**: Sidebar showing all active pushes (collapsible)
- **Push Details**: 
  - Chunk content and metadata
  - Due time and creation time
  - Open note or delete push buttons
- **Evaluation Options**:
  - **Manual Grading**: 5-star rating system with submit button
  - **AI Conversation**: Interactive Q&A with AI tutor
- **Refresh Pushes**: Automatically schedules new pushes based on chunk scores

### AI Conversation Flow

1. Click **"Start AI Conversation"** to begin
2. AI generates a question based on the chunk
3. Type your answer in the input box
4. AI evaluates your response and provides feedback
5. Continue the conversation or click **"End Conversation"** to get immediate evaluation
6. SM2 algorithm updates based on your performance

### Manual Grading Flow

1. Select a star rating (1-5 stars)
2. Click **"Submit Grade"** to apply
3. SM2 algorithm updates based on your grade

## Settings

### LLM Settings

- **LLM API Key**: Your OpenAI API key or compatible API key
- **LLM API Base URL**: API endpoint (default: `https://api.openai.com/v1`)
  - For Alibaba Cloud DashScope: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- **LLM Model**: Model name (e.g., `gpt-3.5-turbo`, `gpt-4`)
- **LLM Request Timeout**: Maximum time to wait for LLM responses (10-300 seconds, default: 60)

### Push Settings

- **Max Active Pushes**: Maximum number of pushes active at the same time (1-20, default: 5)
- **Push Due Window**: Duration of a push in hours before expiration (1-168 hours, default: 24)
- **Push Score Threshold**: Minimum chunk score required for push recommendation (2.0-6.0, default: 2.0)

## Commands

- **Extract chunks from current note**: Extract or update chunks from the active note
- **View chunks for current note**: Open the Note Chunks view
- **Open push center**: Open the Push Center view

## How It Works

### Chunk Extraction

1. **Initial Extraction**: When you first extract chunks, LLM analyzes the note and creates knowledge chunks
2. **Incremental Updates**: When you modify a note and extract again:
   - LLM compares new content with existing chunks
   - Determines which chunks to keep, modify, or delete
   - Creates new chunks for new content
   - For modified chunks, determines update level (minor/moderate/major)
3. **Update Level Impact**:
   - **Minor**: Slight reduction in familiarity and EF
   - **Moderate**: Moderate reduction, one repetition removed
   - **Major**: Significant reduction, repetitions reset to 0

### SM2 Algorithm

The plugin uses the SuperMemo 2 algorithm with the following parameters:

- **E-Factor (EF)**: Ease factor (1.3-2.5) representing memory difficulty
- **Repetitions**: Number of successful reviews
- **Interval**: Days until next review
- **Familiarity Score**: Weighted average of past grades (0.0-1.0)

**Review Intervals**:
- First review: 1 day
- Second review: 6 days
- Subsequent reviews: Previous interval × EF (adjusted by importance)

**Grade Impact**:
- Grade < 3: Reset to beginning (repetitions = 0, interval = 1 day)
- Grade ≥ 3: Increase repetitions, calculate new interval

### Chunk Scoring

Chunks are scored using a formula that considers:

1. **Importance Weight**: Higher importance = higher base score
2. **Familiarity Boost**: Lower familiarity = higher priority
3. **Due Date Boost**: Past due chunks get exponential boost
4. **Future Penalty**: Future due chunks get slight penalty

Only chunks with scores above the threshold are recommended for pushing.

### Automatic Cleanup

- **Deleted Notes**: When a note is deleted, all associated chunks and pushes are automatically removed
- **Expired Pushes**: Pushes past their due window are removed when refreshing
- **Completed Pushes**: Completed pushes are removed when refreshing

## Tips & Best Practices

1. **Start Small**: Begin with a few notes to understand the workflow
2. **Set Importance**: Mark important chunks with higher importance for more frequent review
3. **Regular Reviews**: Use "Refresh Pushes" regularly to keep your review queue active
4. **AI vs Manual**: Use AI conversation for complex topics, manual grading for quick reviews
5. **Update Threshold**: Adjust push score threshold based on your review capacity
6. **LLM Model**: Use GPT-4 for better chunk extraction quality (if available)

## Troubleshooting

### Chunks Not Extracting

- Check your LLM API key is correct
- Verify API base URL is correct for your provider
- Check network connection
- Increase timeout if using slower models

### Pushes Not Appearing

- Click "Refresh Pushes" to schedule new pushes
- Check push score threshold isn't too high
- Ensure chunks have `needsReview` enabled
- Verify chunks have valid due dates

### AI Conversation Not Working

- Check LLM settings are configured correctly
- Verify API key has sufficient credits/quota
- Check timeout setting is appropriate

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch mode)
npm run dev

# Build for production
npm run build
```

## License

MIT

## Author

Jiawei Yang
