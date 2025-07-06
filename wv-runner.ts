#!/usr/bin/env bun
// Single task runner - run as a separate process
import { startBrowserAgent, type ModelUsage } from "magnitude-core";
import * as fs from "fs";
import * as path from "path";
import { createAction } from "magnitude-core";
import z from "zod";
import { chromium } from "patchright";

interface Task {
    web_name: string;
    id: string;
    ques: string;
    web: string;
}

async function main() {
    const taskJson = process.argv[2];
    const runEval = process.argv[3] === 'true';
    const resultsPath = process.argv[4] || 'results/default';
    
    if (!taskJson) {
        console.error("No task provided");
        process.exit(1);
    }
    
    const task: Task = JSON.parse(taskJson);
    const MAX_CRASH_RETRIES = 3;
    let crashAttempts = 0;
    
    // Ensure results directory exists
    if (!fs.existsSync(resultsPath)) {
        fs.mkdirSync(resultsPath, { recursive: true });
    }
    
    // Remove old evaluation file if it exists
    const evalPath = path.join(resultsPath, `${task.id}.eval.json`);
    if (fs.existsSync(evalPath)) {
        fs.unlinkSync(evalPath);
        console.log(`[Runner] Removed old evaluation file: ${evalPath}`);
    }
    
    while (crashAttempts < MAX_CRASH_RETRIES) {
        console.log(`[Runner] Running task: ${task.id} - ${task.ques}`);
        console.log(`[Runner] URL: ${task.web}`);

        let startTime = Date.now();
        let context: any = null;
        let agent: any = null;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let actionCount = 0;

        try {
        const date = new Date();
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        context = await chromium.launchPersistentContext("", {
            channel: "chrome",
            headless: false,
            viewport: { width: 1024, height: 768 },
            deviceScaleFactor: process.platform === 'darwin' ? 2 : 1
        });

        agent = await startBrowserAgent({
            browser: { context: context },
            llm: {
                provider: "claude-code",
                options: {
                    model: "claude-sonnet-4-20250514",
                    temperature: 0.5
                },
            },
            url: task.web,
            actions: [
                createAction({
                    name: "answer",
                    description: "Give final answer",
                    schema: z.string(),
                    resolver: async ({ input, agent }) => {
                        console.log("ANSWER GIVEN:", input);
                        await agent.queueDone();
                    },
                }),
            ],
            narrate: true,
            prompt: `Be careful to satisfy the task criteria precisely. If sequences of actions are failing, go one action at at time.\nConsider that today is ${formattedDate}.`,
            screenshotMemoryLimit: 3,
        });

        agent.events.on("tokensUsed", async (usage: ModelUsage) => {
            totalInputTokens += usage.inputTokens;
            totalOutputTokens += usage.outputTokens;
        });

        agent.events.on("actionDone", async () => {
            const memory = await agent.memory.toJSON();
            actionCount += 1;

            fs.writeFileSync(
                path.join(resultsPath, `${task.id}.json`),
                JSON.stringify(
                    {
                        time: Date.now() - startTime,
                        actionCount,
                        totalInputTokens,
                        totalOutputTokens,
                        memory,
                    },
                    null,
                    4,
                ),
            );
        });

        // Set up timeout
        const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
        await Promise.race([
            agent.act(task.ques),
            new Promise<void>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Task timed out after 20 minutes`));
                }, TIMEOUT_MS);
            })
        ]);

            console.log(`[Runner] Finished task: ${task.id}`);
            
            // Explicitly save final state before exit - ensure answer gets written out
            const finalMemory = await agent.memory.toJSON();
            fs.writeFileSync(
                path.join(resultsPath, `${task.id}.json`),
                JSON.stringify(
                    {
                        time: Date.now() - startTime,
                        actionCount,
                        totalInputTokens,
                        totalOutputTokens,
                        memory: finalMemory,
                    },
                    null,
                    4,
                ),
            );
            
            // Delay to ensure file write completes
            await new Promise(resolve => setTimeout(resolve, 1000));
            process.exit(0);

        } catch (error) {
            const errorMessage = (error as Error).message;
            console.error(`[Runner] Error in task ${task.id}:`, error);
            
            // Check if it's a recoverable crash
            const isRecoverableCrash = errorMessage.includes('net::ERR_ABORTED') || 
                                      errorMessage.includes('Target page, context or browser has been closed') ||
                                      errorMessage.includes('Failed to connect') ||
                                      errorMessage.includes('ENOENT') ||
                                      errorMessage.includes('ECONNREFUSED');
            
            if (isRecoverableCrash && crashAttempts < MAX_CRASH_RETRIES - 1) {
                crashAttempts++;
                console.log(`[Runner] 🔄 Retrying crashed task ${task.id} (crash attempt ${crashAttempts}/${MAX_CRASH_RETRIES})...`);
                // Small delay before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; // Retry the task
            }
            
            // Save error state before failing
            const memory = agent ? await agent.memory.toJSON() : null;
            fs.writeFileSync(
                path.join(resultsPath, `${task.id}.json`),
                JSON.stringify(
                    {
                        time: Date.now() - startTime,
                        actionCount,
                        totalInputTokens,
                        totalOutputTokens,
                        memory,
                        error: errorMessage,
                        timedOut: errorMessage.includes('timed out'),
                        crashAttempts: crashAttempts + 1
                    },
                    null,
                    4,
                ),
            );
            
            process.exit(1); // Failed after retries
        } finally {
            // Cleanup
            try {
                if (agent) await agent.stop();
            } catch (e) {
                console.error("[Runner] Error stopping agent:", e);
            }
            
            try {
                if (context) await context.close();
            } catch (e) {
                console.error("[Runner] Error closing context:", e);
            }
        }
    }
    
    // Should never reach here
    process.exit(1);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});