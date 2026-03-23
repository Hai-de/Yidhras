export interface InferenceService {
  readonly phase: 'planned';
  readonly ready: false;
}

export const createPlaceholderInferenceService = (): InferenceService => {
  return {
    phase: 'planned',
    ready: false
  };
};
