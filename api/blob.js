import { list } from '@vercel/blob';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const resultsPath = url.searchParams.get("resultsPath") || 'default';

  try {
    // Get list of results folders
    if (path === "/api/results-folders") {
      // Try to get the index file first
      const { blobs: indexBlobs } = await list({ prefix: 'results-index.json', limit: 1 });
      
      if (indexBlobs.length > 0) {
        const response = await fetch(indexBlobs[0].url);
        const folders = await response.json();
        res.status(200).json(folders);
      } else {
        // Fallback to listing directories from blob storage
        const { blobs } = await list({ prefix: 'results/' });
        const folders = new Set();
        blobs.forEach(blob => {
          const parts = blob.pathname.split('/');
          if (parts.length >= 3 && parts[0] === 'results') {
            folders.add(parts[1]);
          }
        });
        res.status(200).json(Array.from(folders).sort());
      }
      return;
    }
    
    // Get tasks summary for a specific results folder
    if (path === "/api/tasks-summary") {
      const { blobs } = await list({ prefix: `results/${resultsPath}/summary.json`, limit: 1 });
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        const summary = await response.json();
        res.status(200).json(summary);
      } else {
        res.status(200).json({});
      }
      return;
    }
    
    // Get statistics for a results folder
    if (path === "/api/stats") {
      const { blobs } = await list({ prefix: `results/${resultsPath}/summary.json`, limit: 1 });
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        const summary = await response.json();
        
        let totalTasks = 0;
        let successfulTasks = 0;
        let totalActions = 0;
        let taskCount = 0;
        
        Object.values(summary).forEach(categoryTasks => {
          categoryTasks.forEach(task => {
            totalTasks++;
            if (task.success === true) successfulTasks++;
            if (task.actions) {
              totalActions += task.actions;
              taskCount++;
            }
          });
        });
        
        res.status(200).json({
          totalTasks,
          successfulTasks,
          successRate: totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0,
          avgActions: taskCount > 0 ? totalActions / taskCount : 0,
          categoryStats: summary
        });
      } else {
        res.status(200).json({
          totalTasks: 0,
          successfulTasks: 0,
          successRate: 0,
          avgActions: 0,
          categoryStats: {}
        });
      }
      return;
    }
    
    // Get specific task data
    if (path.startsWith("/api/task/")) {
      const taskId = decodeURIComponent(path.replace("/api/task/", ""));
      
      // Fetch the main task data
      const { blobs: taskBlobs } = await list({ prefix: `results/${resultsPath}/${taskId}.json`, limit: 1 });
      
      // Fetch the evaluation data
      const { blobs: evalBlobs } = await list({ prefix: `results/${resultsPath}/${taskId}.eval.json`, limit: 1 });
      
      const result = {
        memory: { observations: [] },
        task: null,
        evaluation: null
      };
      
      if (taskBlobs.length > 0) {
        const taskResponse = await fetch(taskBlobs[0].url);
        const taskData = await taskResponse.json();
        result.memory = taskData.memory || { observations: [] };
        result.task = taskData.task || null;
        result.time = taskData.time;
        result.actionCount = taskData.actionCount;
        result.totalInputTokens = taskData.totalInputTokens;
        result.totalOutputTokens = taskData.totalOutputTokens;
      }
      
      if (evalBlobs.length > 0) {
        const evalResponse = await fetch(evalBlobs[0].url);
        result.evaluation = await evalResponse.json();
      }
      
      res.status(200).json(result);
      return;
    }
    
    res.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}