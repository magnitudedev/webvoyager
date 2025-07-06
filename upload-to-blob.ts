#!/usr/bin/env bun
import { put, list, del } from '@vercel/blob';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import * as p from '@clack/prompts';

// You need to set BLOB_READ_WRITE_TOKEN environment variable
// Get it from: https://vercel.com/dashboard/stores

async function uploadResultsFolder(folderPath: string, folderName: string) {
  const spinner = p.spinner();
  
  try {
    spinner.start(`Reading files from ${folderPath}`);
    const files = await readdir(folderPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    spinner.stop(`Found ${jsonFiles.length} JSON files`);
    
    let uploaded = 0;
    const errors: string[] = [];
    const taskSummaries: Record<string, any[]> = {};
    
    for (const file of jsonFiles) {
      try {
        spinner.start(`Uploading ${file} (${uploaded + 1}/${jsonFiles.length})`);
        
        const content = await readFile(join(folderPath, file), 'utf-8');
        
        // Extract summary info for non-eval files
        if (!file.endsWith('.eval.json')) {
          const taskId = file.replace('.json', '');
          const category = taskId.split('--')[0];
          const data = JSON.parse(content);
          
          if (!taskSummaries[category]) {
            taskSummaries[category] = [];
          }
          
          // Store only essential info in summary
          taskSummaries[category].push({
            id: taskId,
            time: data.time,
            actions: data.actionCount,
            tokens: (data.totalInputTokens || 0) + (data.totalOutputTokens || 0)
          });
        }
        
        const blob = await put(`results/${folderName}/${file}`, content, {
          access: 'public',
          contentType: 'application/json',
        });
        
        uploaded++;
        spinner.stop(`✓ Uploaded ${file}`);
      } catch (error) {
        errors.push(`${file}: ${error}`);
        spinner.stop(`✗ Failed ${file}`);
      }
    }
    
    // Process eval files to add success status to summaries
    spinner.start('Processing evaluation results');
    for (const file of jsonFiles.filter(f => f.endsWith('.eval.json'))) {
      try {
        const taskId = file.replace('.eval.json', '');
        const category = taskId.split('--')[0];
        const content = await readFile(join(folderPath, file), 'utf-8');
        const evalData = JSON.parse(content);
        
        if (taskSummaries[category]) {
          const task = taskSummaries[category].find(t => t.id === taskId);
          if (task) {
            task.success = evalData.result === 'SUCCESS';
          }
        }
      } catch (error) {
        console.error(`Error processing eval for ${file}:`, error);
      }
    }
    spinner.stop('✓ Processed evaluations');
    
    // Upload task summaries
    spinner.start('Uploading task summary index');
    await put(`results/${folderName}/summary.json`, JSON.stringify(taskSummaries), {
      access: 'public',
      contentType: 'application/json',
    });
    spinner.stop('✓ Uploaded task summary');
    
    // Upload folder metadata
    spinner.start('Updating folder index');
    const indexBlob = await list({ prefix: 'results/' });
    const folders = new Set<string>();
    
    indexBlob.blobs.forEach(blob => {
      const parts = blob.pathname.split('/');
      if (parts.length >= 3 && parts[0] === 'results') {
        folders.add(parts[1]!);
      }
    });
    
    await put('results-index.json', JSON.stringify(Array.from(folders).sort()), {
      access: 'public',
      contentType: 'application/json',
    });
    spinner.stop('✓ Updated folder index');
    
    p.outro(`Uploaded ${uploaded}/${jsonFiles.length} files from ${folderName}`);
    
    if (errors.length > 0) {
      console.error('\nErrors:');
      errors.forEach(err => console.error(`  - ${err}`));
    }
    
  } catch (error) {
    spinner.stop('Failed');
    throw error;
  }
}

async function uploadTasks() {
  const spinner = p.spinner();
  
  try {
    spinner.start('Uploading tasks file');
    const content = await readFile('./data/patchedTasks.jsonl', 'utf-8');
    
    await put('data/patchedTasks.jsonl', content, {
      access: 'public',
      contentType: 'text/plain',
    });
    
    spinner.stop('✓ Uploaded tasks file');
  } catch (error) {
    spinner.stop('✗ Failed to upload tasks file');
    throw error;
  }
}

async function main() {
  p.intro('WebVoyager Results Uploader');
  
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    p.cancel('BLOB_READ_WRITE_TOKEN environment variable is required');
    p.note('Get your token from: https://vercel.com/dashboard/stores');
    process.exit(1);
  }
  
  const mode = await p.select({
    message: 'What would you like to upload?',
    options: [
      { value: 'all', label: 'All results folders and tasks file' },
      { value: 'folder', label: 'Specific results folder' },
      { value: 'tasks', label: 'Tasks file only' },
    ],
  });
  
  if (p.isCancel(mode)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }
  
  try {
    if (mode === 'all' || mode === 'tasks') {
      await uploadTasks();
    }
    
    if (mode === 'all' || mode === 'folder') {
      const resultsDir = './results';
      const entries = await readdir(resultsDir, { withFileTypes: true });
      const folders = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
      
      if (folders.length === 0) {
        p.log.error('No results folders found');
        process.exit(1);
      }
      
      if (mode === 'folder') {
        const selected = await p.select({
          message: 'Select folder to upload',
          options: folders.map(f => ({ value: f, label: f })),
        });
        
        if (p.isCancel(selected)) {
          p.cancel('Operation cancelled');
          process.exit(0);
        }
        
        await uploadResultsFolder(join(resultsDir, selected as string), selected as string);
      } else {
        // Upload all folders
        for (const folder of folders) {
          p.log.info(`\nUploading ${folder}...`);
          await uploadResultsFolder(join(resultsDir, folder), folder);
        }
      }
    }
    
    p.outro('Upload complete! 🎉');
    
  } catch (error) {
    p.log.error(`Upload failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch(console.error);