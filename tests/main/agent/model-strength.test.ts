import { describe, it, expect } from 'vitest';
import { modelStrength, paramsB } from '@main/agent/model-strength';

describe('modelStrength', () => {
  it('cloud providers and Ollama cloud models are cloud', () => {
    expect(modelStrength('claude-sonnet-5-5')).toBe('cloud');
    expect(modelStrength('gpt-5')).toBe('cloud');
    expect(modelStrength('gemini-2.5-pro')).toBe('cloud');
    expect(modelStrength('gpt-oss:120b-cloud')).toBe('cloud');
  });

  it('local models split by parameter count', () => {
    expect(modelStrength('qwen2.5-coder:14b')).toBe('local-small');
    expect(modelStrength('qwen2.5:7b')).toBe('local-small');
    expect(modelStrength('llama3.3:70b')).toBe('local-large');
    expect(modelStrength('qwen2.5:32b-instruct-q4_K_M')).toBe('local-large');
    expect(modelStrength('llama3')).toBe('local-small'); // size unknown → assume small
    expect(modelStrength('')).toBe('local-small');
  });

  it('paramsB reads sizes, including MoE', () => {
    expect(paramsB('mixtral:8x7b')).toBe(56);
    expect(paramsB('phi3:3.8b')).toBe(3.8);
    expect(paramsB('llama3')).toBeNull();
  });
});
