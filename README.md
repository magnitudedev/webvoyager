<div align="center">
  <img src="assets/logo.svg" alt="Magnitude Text Logo" width="100"/>
</div>

<hr style="height: 1px; border: none; background-color: #e1e4e8; margin: 24px 0;">

# Magnitude WebVoyager

Magnitude achieves state-of-the-art performance with **93.9% success rate** on WebVoyager, beating all other browser agents, including OpenAI Operator, browser-use, and others.

Comprehensive task results for our run are available [here](https://magnitude-webvoyager.vercel.app/). You can also use this repo to [reproduce our results](#reproducing-results).

The [original WebVoyager benchmark](https://github.com/MinorJerry/WebVoyager) was meant to demonstrate a new technique for interacting with the browser by annotating the DOM. Since then, vision models have come a long way in terms of accuracy and visual understanding. Based on these results, our pure-vision approach proves stronger than techniques that rely on the DOM for interaction (like the original WebVoyager agent or browser-use), while our agentic architecture is more robust than lightweight tool wrappers like Operator.

## 📊 Results

### 🤖 Agent comparison


| Browser Agent         | WebVoyager Success Rate (pass@1)| WebVoyager Avg Steps |
| --------------------- | ----------------------- | -------------------- |
| Magnitude             | **93.9%**                   | **15.5**                 |
| browser-use           | 89.1%                   | 18.11                |
| OpenAI Operator              | 87.0%                   | Unknown              |
| Skyvern               | 85.9%                   | Unknown              |
| WebVoyager (original) | 59.1%                   | Unknown              |



### Success rate by category

| Category | Success Rate | Avg Actions |
|----------|--------------|-------------|
| Allrecipes | 40/40 (100.0%) | 13.3 |
| Amazon | 36/38 (94.7%) | 14.2 |
| Apple | 33/34 (97.1%) | 10.9 |
| ArXiv | 36/42 (85.7%) | 17.9 |
| BBC News | 33/34 (97.1%) | 12.2 |
| Booking | 38/40 (95.0%) | 37.6 |
| Cambridge Dictionary | 41/43 (95.3%) | 9.9 |
| Coursera | 37/40 (92.5%) | 11.8 |
| ESPN | 40/41 (97.6%) | 11.6 |
| GitHub | 39/39 (100.0%) | 10.6 |
| Google Flights | 36/39 (92.3%) | 33.4 |
| Google Map | 35/38 (92.1%) | 16.0 |
| Google Search | 37/40 (92.5%) | 7.7 |
| Huggingface | 34/36 (94.4%) | 13.3 |
| Wolfram Alpha | 39/46 (84.8%) | 12.0 |
| **Total** | **554/590 (93.9%)** | **15.5** |


## ℹ️ About the benchmark

### Success / failure conditions
The Agent fails if the answer it provided is incorrect, if its answer is not derived from information it found directly in the browser, or if it exceeds a 20 minute time limit. The agent only succeeds if it provides the correct answer, grounded in details found via the browser.

### Task patches
The original WebVoyager benchmark contains many tasks which are time-dependent and thus outdated, or have criteria that are impossible to meet. So to make the benchmark possible, we make patches to update dates on several tasks, and remove a few impossible tasks as well. For details on exactly what changes we made to the original tasks, see [patches.json](data/patches.json).


## Reproducing results
We include the results from our pass@1 evaluation to [view easily](https://magnitude-webvoyager.vercel.app/), however if you would like to confirm our findings we aim to make that easy as well.

> Keep in mind that running the full benchmark is time consuming and expensive.

To run our WebVoyager eval:
- Install bun (https://bun.sh/)
- If you have a Claude Pro or Max plan, that can be used to authenticate with Magnitude. Otherwise, edit the LLM providers in `ws.ts` e.g. with an ANTHROPIC_API_KEY.
- Run the eval with the cli: `bun wv.ts run -w 4`
    - Use appropriate number of workers based on your rate limit
    - For GitHub category, run with 1 worker, and may need to take some minutes between tasks because of GitHub rate limits
- After running tasks, eval them with `bun wv.ts eval -w 4`. Keep in mind that the eval prompt is not perfect, and some evaluations may require human review.

> Running 6 tasks in parallel worked well for us most of the time, however may depend on your bandwidth and will definitely depend on provider rate limits 

### Human evaluations
There were some false positives as well as false negatives in the evaluation results produced by the LLM judge. Manual review was required in some cases.


## What went right

### 🦾 Architectural strengths
- Pure vision approach - use grounded model (Claude Sonnet 4). Avoids weirdness and edge cases of DOM-based / set-of-marks interaction, and simpler for LLM to understand what is going on.
    - Concrete examples of where this is very relevant - manipulating price sliders on Amazon tasks, interacting with the minigames in Cambridge Dictionary
- Simple CoT injection before each action sequence - ask for reasoning + actions
- Allow reasoning to build on itself. Include reasoning chains in future turns
    - Advantage: give ability to plan over time in a highly flexible way
    - Disadvantage: sometimes gets stuck in a "reasoning loop"
- Concentrated, relevant context window. Limit reasoning to last 20 turns, only keep last few screenshots. Don't overcomplicate the agent loop

## Challenges encountered

### ☁️ Cloudflare and Captchas
Cambridge Dictionary is riddled with Cloudflare blockers and Captchas. Using persistent Chrome contexts with patches applied (`patchright`) took care of this problem.

### ⚠️ Rate limiting (GitHub)
Running GitHub tasks in parallel would quickly run into rate limits on those tasks - where a page would show "Too many requests". Running this tasks sequentially and with some break between usually resolved this - but would sometimes have to space tasks a couple minutes apart.

### 💥 Browser crashes
Since we ran the benchmark with several real Chrome instances doing different tasks in parallel, occasionally tasks would crash the browser before they started - or the browser would even randomly crash in the middle of the task. For these tasks, we would run them again since its only a machine / browser issue and not the agent.



## 💡 Notable findings

### ❌ Failure Archetypes
Failures usually fit into one of a few buckets:
1. Treating task as a user query rather than strict conditions to meet
    - Agent would sometimes make reasonable decisions as if it were helping a real user, but might therefore fail to meet the strict requirements of the task.
2. Answering based on pre-training knowledge instead of browser content
    - The agent did this for several Wolfram Alpha tasks, using its own knowledge instead of figuring out how to get the answer from the site
3. Make false assumption early without questioning it later
    - This highlights a disadvantage of maintaining a reasoning chain in context. A good example of this was `ArXiv--25`, where the agent didn't find the merch store on ArXiV quickly enough, so it (falsely) assumed it didn't exist and went on other sites
4. Timeouts - failure to answer within a reasonable time period

(1) and (2), which made up the majority of failures, could likely be remedied significantly by simply adding some additional instructions to our agent's system prompt.

## ⏩ Towards a better browser eval
- Mostly we wanted to run WebVoyager because it is a popular eval amongst browser agents, but overall it is a very strange and awkward eval to run. Dates have to be patched in order for tasks to be possible, some tasks depend on time of day, and many tasks are ambiguous. In addition, these tasks rely on live sites which are constantly changing
- We know other benchmarks like WebArena exist as well, but we are hoping that more robust and challenging benchmarks for browser agents are created over time
