import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { gapDiagnoserSystemPrompt } from '../prompts/system-prompt';
import { GapReportSchema } from '../validators/gap-schema';
import { ComparisonResult } from '../types/gap-types';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AIDiagnoserService {
  async generateGapReport(comparisonResult: ComparisonResult) {
    const prompt = `
      Please analyze the following deterministic comparison results and generate a structured Gap Report.
      
      Comparison Data:
      ${JSON.stringify(comparisonResult, null, 2)}
    `;

    const promptVersion = 'v1.0.0';
    const promptHash = createHash('sha256')
      .update(gapDiagnoserSystemPrompt + prompt)
      .digest('hex');

    const startTime = Date.now();
    let modelName = 'gemini-2.5-flash';
    let modelProvider: any;

    if (process.env.OPENAI_API_KEY) {
      modelName = 'gpt-4o-mini';
      modelProvider = openai(modelName);
    } else {
      modelName = 'gemini-2.5-flash';
      modelProvider = google(modelName);
    }

    try {
      // Call generateObject with timeout
      const result = await generateObject({
        model: modelProvider,
        system: gapDiagnoserSystemPrompt,
        prompt: prompt,
        schema: GapReportSchema,
        abortSignal: AbortSignal.timeout(30000), // 30-second timeout for resilience
      });

      const latency = Date.now() - startTime;
      const processingTime = latency;

      // Extract tokens and response metadata safely
      const usage = result.usage as any;
      const promptTokens = usage?.promptTokens || usage?.promptTokenCount || 0;
      const completionTokens = usage?.completionTokens || usage?.completionTokenCount || 0;
      const totalTokens = usage?.totalTokens || usage?.totalTokenCount || 0;
      
      // Determine response ID from response structure
      let responseId = 'unknown-id';
      if (result.response && (result.response as any).id) {
        responseId = (result.response as any).id;
      } else {
        responseId = `res-${createHash('md5').update(JSON.stringify(result.object)).digest('hex')}`;
      }

      // Prepare logging metadata (excluding sensitive data)
      const logData = {
        timestamp: new Date().toISOString(),
        model: modelName,
        promptVersion,
        promptHash,
        latencyMs: latency,
        processingTimeMs: processingTime,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
        },
        responseId
      };

      // Write to console
      console.log('AI Execution Log:', JSON.stringify(logData, null, 2));

      // Append to local log file in workspace
      try {
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(
          path.join(logDir, 'ai-execution.log'),
          JSON.stringify(logData) + '\n',
          'utf8'
        );
      } catch (logErr) {
        console.error('Failed to write to log file:', logErr);
      }

      return result.object;
    } catch (error: any) {
      const latency = Date.now() - startTime;
      console.error(`AI Diagnoser Error after ${latency}ms:`, error);
      
      // Map to meaningful messages depending on failure type
      if (error.name === 'TimeoutError') {
        throw new Error(`OpenAI/Gemini API Timeout: Request took longer than 30s. Latency: ${latency}ms`);
      } else if (error.message && error.message.includes('JSON')) {
        throw new Error(`Invalid Structured Output received from LLM model ${modelName}. Error: ${error.message}`);
      }
      
      throw new Error(`AI Gap Diagnosis failed: ${error.message || error}`);
    }
  }
}
