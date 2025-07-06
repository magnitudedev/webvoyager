# Deploying WebVoyager Viewer to Vercel

## Setup

1. Install dependencies:
```bash
bun install
```

2. Set up Vercel Blob Storage:
   - Go to https://vercel.com/dashboard/stores
   - Create a new Blob store
   - Copy the `BLOB_READ_WRITE_TOKEN`

3. Upload your results to Blob storage:
```bash
# Set the token
export BLOB_READ_WRITE_TOKEN="your-token-here"

# Upload all results and tasks
bun run upload

# Or upload specific folder
bun run upload  # Then select "Specific results folder"
```

4. Deploy to Vercel:
```bash
vercel
```

Follow the prompts and make sure to:
- Link the Blob store to your project
- The deployment will automatically use the Blob storage

## How It Works

- Results are stored in Vercel Blob Storage (not deployed with the app)
- Each file is stored as: `results/{folder}/{taskId}.json`
- The viewer fetches files on-demand from Blob storage
- An index file tracks available folders

## Local Development

To run the viewer locally with local files:
```bash
bun run viewer.ts
```

To test with Blob storage locally:
```bash
# Set your blob token
export BLOB_READ_WRITE_TOKEN="your-token-here"

# Run vercel dev
vercel dev
```

## File Structure

```
webvoyager/
├── api/
│   ├── blob.ts         # Blob storage API
│   └── index.ts        # Local file API (for dev)
├── public/
│   └── index.html      # Static frontend
├── upload-to-blob.ts   # Upload script
├── vercel.json         # Vercel configuration
└── package.json
```

## Updating Results

To update results after deployment:
```bash
# Upload new results
export BLOB_READ_WRITE_TOKEN="your-token-here"
bun run upload
```

No need to redeploy - the viewer will automatically show new data!

## Notes

- Results are NOT included in the deployment (stored in Blob)
- The viewer fetches data on-demand from Blob storage
- Supports unlimited result sizes without affecting deployment
- Results can be updated independently of the viewer