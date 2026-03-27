import type { InferenceTraceSink } from '../trace_sink.js';

export const createNoopInferenceTraceSink = (): InferenceTraceSink => {
  return {
    async record() {
      return;
    }
  };
};
