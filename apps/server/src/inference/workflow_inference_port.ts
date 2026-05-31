/** Minimal inference service port for workflow engine — avoids import cycle from inference/service.ts. */

export interface WorkflowInferencePort {
  submitInferenceJob(input: import('./types.js').InferenceRequestInput): Promise<import('./types.js').InferenceJobSubmitResult>;
  executeDecisionJob(jobId: string, options: { workerId: string }): Promise<import('./types.js').InferenceRunResult | null>;
}
