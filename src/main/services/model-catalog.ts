// Curated Ollama model catalog with hardware-fit scoring.
// Speed estimates assume the entire model fits in VRAM (full GPU offload).
// CPU-only inference is much slower (~5-15× depending on quant + cores).

import type { HardwareInfo } from './hardware-info';

export type FitMode = 'gpu' | 'partial' | 'cpu' | 'cloud' | 'no';
export type QualityTier = 'basic' | 'good' | 'great' | 'flagship';

export interface ModelInfo {
  /** Ollama pull tag for local, or provider model id for cloud. */
  id: string;
  /** Pretty display name */
  name: string;
  /** Approx download/runtime size in GB (Q4_K_M quant in most cases). 0 for cloud. */
  sizeGB: number;
  /** Output quality, 1 (cheap) to 5 (state-of-the-art for size class). */
  quality: 1 | 2 | 3 | 4 | 5;
  qualityTier: QualityTier;
  /**
   * Baseline tokens/sec when fully offloaded, calibrated to the reference GPU
   * (RTX 4070 Ti Super). scoreCatalog() scales this by hw.perfFactor so the
   * shown speed reflects the user's ACTUAL detected GPU, not this baseline.
   */
  estTokPerSecGpu: number;
  /** Whether the model supports tool calls. */
  toolsCapable: boolean;
  tags: Array<'general' | 'code' | 'reasoning' | 'vision' | 'small'>;
  description: string;
  /** Cloud provider — undefined for local Ollama models. */
  cloud?: 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'groq' | 'mistral' | 'xai';
}

// Hand-picked, conservative. All numbers approximate.
export const CATALOG: ModelInfo[] = [
  // —— Cloud — Anthropic ——
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 80,
    toolsCapable: true,
    cloud: 'anthropic',
    tags: ['general', 'code', 'reasoning'],
    description: 'Anthropic flagship. Best tools support, long context, strong code.',
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 50,
    toolsCapable: true,
    cloud: 'anthropic',
    tags: ['reasoning', 'general'],
    description: 'Anthropic most-capable. Slower, deeper reasoning. Pricier.',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 140,
    toolsCapable: true,
    cloud: 'anthropic',
    tags: ['small', 'general'],
    description: 'Anthropic fast tier. Cheap + quick with full tool support.',
  },

  // —— Cloud — OpenAI ——
  {
    id: 'gpt-5',
    name: 'GPT-5',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 70,
    toolsCapable: true,
    cloud: 'openai',
    tags: ['general', 'code', 'reasoning'],
    description: 'OpenAI flagship. Strong code + reasoning, native tools.',
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 130,
    toolsCapable: true,
    cloud: 'openai',
    tags: ['small', 'general'],
    description: 'Faster + cheaper sibling of GPT-5.',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 60,
    toolsCapable: true,
    cloud: 'openai',
    tags: ['general', 'code'],
    description: 'Previous flagship. Reliable for tools + long output.',
  },
  {
    id: 'o4-mini',
    name: 'OpenAI o4-mini',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 40,
    toolsCapable: true,
    cloud: 'openai',
    tags: ['reasoning'],
    description: 'Reasoning model. Slower output, deeper thinking.',
  },

  // —— Cloud — Google Gemini ——
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 60,
    toolsCapable: true,
    cloud: 'gemini',
    tags: ['general', 'code', 'reasoning'],
    description: 'Google flagship. 2M token context, multimodal, tools.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 150,
    toolsCapable: true,
    cloud: 'gemini',
    tags: ['small', 'general'],
    description: 'Faster + cheaper Gemini. Strong for everyday tasks.',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 170,
    toolsCapable: true,
    cloud: 'gemini',
    tags: ['small', 'general'],
    description: 'Previous-gen flash. Cheap, fast, tool-capable.',
  },

  // —— Cloud — Perplexity ——
  {
    id: 'sonar-pro',
    name: 'Sonar Pro (Perplexity)',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 100,
    toolsCapable: false,
    cloud: 'perplexity',
    tags: ['general'],
    description: 'Web-grounded answers with citations. Built-in browsing.',
  },
  {
    id: 'sonar-reasoning-pro',
    name: 'Sonar Reasoning Pro',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 50,
    toolsCapable: false,
    cloud: 'perplexity',
    tags: ['reasoning'],
    description: 'Reasoning + live web. Slower, deeper answers with citations.',
  },
  {
    id: 'sonar',
    name: 'Sonar',
    sizeGB: 0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 140,
    toolsCapable: false,
    cloud: 'perplexity',
    tags: ['small', 'general'],
    description: "Perplexity's lightweight search-grounded model.",
  },

  // —— Cloud — Groq (OpenAI-compatible API) ——
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 280,
    toolsCapable: true,
    cloud: 'groq',
    tags: ['general'],
    description: 'Meta flagship on Groq LPU — extremely fast inference.',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    sizeGB: 0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 750,
    toolsCapable: true,
    cloud: 'groq',
    tags: ['small', 'general'],
    description: 'Sub-second responses. Use for routing or quick lookups.',
  },
  {
    id: 'qwen-2.5-32b',
    name: 'Qwen 2.5 32B (Groq)',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 200,
    toolsCapable: true,
    cloud: 'groq',
    tags: ['general'],
    description: 'Qwen 32B running on Groq — fast + competent.',
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill 70B (Groq)',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 270,
    toolsCapable: false,
    cloud: 'groq',
    tags: ['reasoning'],
    description: 'R1 reasoning distilled into Llama 70B, fast on Groq.',
  },

  // —— Cloud — Mistral ——
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    cloud: 'mistral',
    tags: ['general', 'code'],
    description: 'Mistral flagship via official API. Strong tools support.',
  },
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 110,
    toolsCapable: true,
    cloud: 'mistral',
    tags: ['general'],
    description: 'Mid-tier Mistral. Balanced speed + quality.',
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 90,
    toolsCapable: true,
    cloud: 'mistral',
    tags: ['code'],
    description: "Mistral's code specialist. Fast + strong at completions.",
  },

  // —— Cloud — xAI (Grok) ——
  {
    id: 'grok-4',
    name: 'Grok 4',
    sizeGB: 0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    cloud: 'xai',
    tags: ['general', 'reasoning'],
    description: "xAI flagship. Strong reasoning, long context, tools.",
  },
  {
    id: 'grok-3',
    name: 'Grok 3',
    sizeGB: 0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 80,
    toolsCapable: true,
    cloud: 'xai',
    tags: ['general'],
    description: 'Previous Grok generation. Solid all-rounder.',
  },
  {
    id: 'grok-3-mini',
    name: 'Grok 3 Mini',
    sizeGB: 0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 140,
    toolsCapable: true,
    cloud: 'xai',
    tags: ['small', 'general'],
    description: 'Smaller, cheaper Grok. Fast for everyday work.',
  },

  // —— Small / fast ——
  {
    id: 'qwen2.5:0.5b',
    name: 'Qwen 2.5 0.5B',
    sizeGB: 0.4,
    quality: 2,
    qualityTier: 'basic',
    estTokPerSecGpu: 220,
    toolsCapable: true,
    tags: ['small', 'general'],
    description: 'Tiny, fast, basic reasoning. Good for routing or scratch use.',
  },
  {
    id: 'qwen2.5:1.5b',
    name: 'Qwen 2.5 1.5B',
    sizeGB: 1.0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 180,
    toolsCapable: true,
    tags: ['small', 'general'],
    description: 'Fast everyday model. Surprisingly good for its size.',
  },
  {
    id: 'qwen2.5:3b',
    name: 'Qwen 2.5 3B',
    sizeGB: 2.0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 140,
    toolsCapable: true,
    tags: ['general'],
    description: 'Step up from 1.5B with noticeably better coherence.',
  },
  {
    id: 'gemma2:2b',
    name: 'Gemma 2 2B',
    sizeGB: 1.6,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 160,
    toolsCapable: false,
    tags: ['small', 'general'],
    description: 'Google small model. Strong for chat, no tools.',
  },
  {
    id: 'phi3.5:3.8b',
    name: 'Phi 3.5 Mini',
    sizeGB: 2.2,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 130,
    toolsCapable: false,
    tags: ['small', 'general'],
    description: 'Microsoft small model. Punches above its weight.',
  },

  // —— Mid / balanced ——
  {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    sizeGB: 4.7,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 95,
    toolsCapable: true,
    tags: ['general'],
    description: 'Best balanced default. Strong tools support, fits 8GB+ VRAM.',
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    sizeGB: 4.7,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 95,
    toolsCapable: false,
    tags: ['code'],
    description: 'Best small code model. Emits tool calls as JSON text — works but no native tool spec.',
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    sizeGB: 4.7,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 90,
    toolsCapable: true,
    tags: ['general'],
    description: 'Meta’s solid all-rounder. Reliable tools.',
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B',
    sizeGB: 5.4,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 80,
    toolsCapable: false,
    tags: ['general'],
    description: 'Strong general model. No tools support.',
  },
  {
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 7B',
    sizeGB: 4.7,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 90,
    toolsCapable: false,
    tags: ['reasoning'],
    description: 'Strong reasoning via thinking traces. Slower effective output.',
  },
  {
    id: 'mistral-nemo:12b',
    name: 'Mistral Nemo 12B',
    sizeGB: 7.1,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 70,
    toolsCapable: true,
    tags: ['general'],
    description: 'Long context (128k), strong tools. Needs 10GB+ VRAM.',
  },

  // —— Large / quality ——
  {
    id: 'qwen2.5:14b',
    name: 'Qwen 2.5 14B',
    sizeGB: 9.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    tags: ['general'],
    description: 'Best quality at this size. Recommended for 12GB+ VRAM.',
  },
  {
    id: 'qwen2.5-coder:14b',
    name: 'Qwen 2.5 Coder 14B',
    sizeGB: 9.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    tags: ['code'],
    description: 'Best local code model. Native tools support.',
  },
  {
    id: 'deepseek-r1:14b',
    name: 'DeepSeek R1 14B',
    sizeGB: 9.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 50,
    toolsCapable: false,
    tags: ['reasoning'],
    description: 'Strong reasoning. Thinking traces slow effective output.',
  },
  {
    id: 'mistral-small:22b',
    name: 'Mistral Small 22B',
    sizeGB: 13.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 38,
    toolsCapable: true,
    tags: ['general'],
    description: 'Quality jump over Nemo. Needs 16GB+ VRAM.',
  },

  // —— Beast (need lots of VRAM) ——
  {
    id: 'qwen2.5:32b',
    name: 'Qwen 2.5 32B',
    sizeGB: 20.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 26,
    toolsCapable: true,
    tags: ['general'],
    description: 'Near-flagship quality. Needs 24GB+ VRAM or partial offload.',
  },
  {
    id: 'qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder 32B',
    sizeGB: 20.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 26,
    toolsCapable: true,
    tags: ['code'],
    description: 'Strongest local code model. 24GB+ VRAM recommended.',
  },
  {
    id: 'deepseek-r1:32b',
    name: 'DeepSeek R1 32B',
    sizeGB: 20.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 22,
    toolsCapable: false,
    tags: ['reasoning'],
    description: 'Powerful reasoning. Slow on most consumer GPUs.',
  },
  {
    id: 'llama3.3:70b',
    name: 'Llama 3.3 70B',
    sizeGB: 40.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 12,
    toolsCapable: true,
    tags: ['general'],
    description: 'Flagship Meta model. Needs 48GB+ VRAM or heavy offload.',
  },

  // —— Llama 3.2 family (newer-gen small Llamas) ——
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    sizeGB: 1.3,
    quality: 2,
    qualityTier: 'basic',
    estTokPerSecGpu: 200,
    toolsCapable: true,
    tags: ['small', 'general'],
    description: 'Tiny Meta model. Fast routing / classification.',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    sizeGB: 2.0,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 150,
    toolsCapable: true,
    tags: ['small', 'general'],
    description: 'Small Meta model with reliable tool calls.',
  },

  // —— Qwen 3 (next generation) ——
  {
    id: 'qwen3:4b',
    name: 'Qwen 3 4B',
    sizeGB: 2.6,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 130,
    toolsCapable: true,
    tags: ['general'],
    description: 'Strong small Qwen 3. Tools + reasoning toggle.',
  },
  {
    id: 'qwen3:8b',
    name: 'Qwen 3 8B',
    sizeGB: 5.2,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 90,
    toolsCapable: true,
    tags: ['general'],
    description: 'Qwen 3 mid-size. Solid all-rounder, native tools.',
  },
  {
    id: 'qwen3:14b',
    name: 'Qwen 3 14B',
    sizeGB: 9.3,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    tags: ['general'],
    description: 'Best Qwen 3 dense in 12 GB class.',
  },
  {
    id: 'qwen3:32b',
    name: 'Qwen 3 32B',
    sizeGB: 20.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 26,
    toolsCapable: true,
    tags: ['general', 'reasoning'],
    description: 'Flagship dense Qwen 3. 24 GB+ VRAM.',
  },
  {
    id: 'qwen3-coder:30b',
    name: 'Qwen 3 Coder 30B (MoE)',
    sizeGB: 18.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 60,
    toolsCapable: true,
    tags: ['code'],
    description: 'MoE coder — fast for its size. 20 GB+ VRAM.',
  },

  // —— Gemma 3 (Google, newer) ——
  {
    id: 'gemma3:1b',
    name: 'Gemma 3 1B',
    sizeGB: 0.8,
    quality: 2,
    qualityTier: 'basic',
    estTokPerSecGpu: 210,
    toolsCapable: false,
    tags: ['small', 'general'],
    description: 'Tiny Google model. Quick chat, no tools.',
  },
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 4B',
    sizeGB: 3.3,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 115,
    toolsCapable: false,
    tags: ['general', 'vision'],
    description: 'Multimodal small Gemma 3. Reads images.',
  },
  {
    id: 'gemma3:12b',
    name: 'Gemma 3 12B',
    sizeGB: 8.1,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 65,
    toolsCapable: false,
    tags: ['general', 'vision'],
    description: 'Multimodal Gemma 3. Strong but no tools.',
  },
  {
    id: 'gemma3:27b',
    name: 'Gemma 3 27B',
    sizeGB: 17.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 32,
    toolsCapable: false,
    tags: ['general', 'vision'],
    description: 'Flagship Gemma 3 (multimodal). 20 GB+ VRAM.',
  },

  // —— Phi 4 (Microsoft) ——
  {
    id: 'phi4:14b',
    name: 'Phi 4 14B',
    sizeGB: 9.1,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 55,
    toolsCapable: false,
    tags: ['general', 'reasoning'],
    description: 'Strong reasoning at 14B. No native tools.',
  },

  // —— GPT-OSS (OpenAI open weights) ——
  {
    id: 'gpt-oss:20b',
    name: 'GPT-OSS 20B',
    sizeGB: 13.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 55,
    toolsCapable: true,
    tags: ['general'],
    description: "OpenAI's open-weights GPT. Tool-capable. 16 GB+ VRAM.",
  },
  {
    id: 'gpt-oss:120b',
    name: 'GPT-OSS 120B',
    sizeGB: 65.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 9,
    toolsCapable: true,
    tags: ['general'],
    description: "OpenAI's flagship open model. Needs 80 GB+ VRAM.",
  },

  // —— GLM (Zhipu AI) ——
  {
    id: 'glm4:9b',
    name: 'GLM-4 9B',
    sizeGB: 5.5,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 75,
    toolsCapable: true,
    tags: ['general'],
    description: 'Zhipu GLM-4. Strong multilingual, tools support.',
  },
  {
    id: 'glm4.5-air',
    name: 'GLM 4.5 Air',
    sizeGB: 7.0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 65,
    toolsCapable: true,
    tags: ['general'],
    description: 'Air variant of GLM 4.5. Balanced quality/speed.',
  },

  // —— Kimi (Moonshot AI) ——
  {
    id: 'kimi-k2:1t-cloud',
    name: 'Kimi K2 1T (cloud)',
    sizeGB: 600.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 0,
    toolsCapable: true,
    tags: ['general', 'reasoning'],
    description: 'Trillion-param MoE. Cloud-only on Ollama; local would need a datacenter.',
  },

  // —— Nemotron (NVIDIA) ——
  {
    id: 'nemotron-mini:4b',
    name: 'Nemotron Mini 4B',
    sizeGB: 2.7,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 120,
    toolsCapable: true,
    tags: ['small', 'general'],
    description: "NVIDIA's distilled mini. Function calling tuned.",
  },
  {
    id: 'nemotron:70b',
    name: 'Nemotron 70B',
    sizeGB: 40.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 13,
    toolsCapable: true,
    tags: ['general'],
    description: 'NVIDIA tune of Llama 3.1 70B. RLHF-strong.',
  },

  // —— Mistral family extras ——
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    sizeGB: 4.4,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 100,
    toolsCapable: true,
    tags: ['general'],
    description: 'Classic Mistral 7B. Solid baseline.',
  },
  {
    id: 'mistral-large:123b',
    name: 'Mistral Large 123B',
    sizeGB: 70.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 7,
    toolsCapable: true,
    tags: ['general'],
    description: "Mistral's flagship. 80 GB+ VRAM territory.",
  },

  // —— Command-R (Cohere) ——
  {
    id: 'command-r:35b',
    name: 'Command R 35B',
    sizeGB: 20.0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 28,
    toolsCapable: true,
    tags: ['general'],
    description: 'Cohere model tuned for RAG + tool use.',
  },
  {
    id: 'command-r-plus:104b',
    name: 'Command R+ 104B',
    sizeGB: 59.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 8,
    toolsCapable: true,
    tags: ['general'],
    description: 'Cohere flagship for enterprise RAG. 72 GB+ VRAM.',
  },

  // —— Aya (Cohere multilingual) ——
  {
    id: 'aya:8b',
    name: 'Aya 8B',
    sizeGB: 4.8,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 85,
    toolsCapable: false,
    tags: ['general'],
    description: 'Multilingual model — 23 languages, balanced.',
  },
  {
    id: 'aya:35b',
    name: 'Aya 35B',
    sizeGB: 20.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 28,
    toolsCapable: false,
    tags: ['general'],
    description: 'Big multilingual. 24 GB+ VRAM.',
  },

  // —— Yi (01.AI) ——
  {
    id: 'yi:9b',
    name: 'Yi 9B',
    sizeGB: 5.0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 80,
    toolsCapable: false,
    tags: ['general'],
    description: 'Chinese-English bilingual. Reasoning solid.',
  },
  {
    id: 'yi:34b',
    name: 'Yi 34B',
    sizeGB: 19.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 30,
    toolsCapable: false,
    tags: ['general'],
    description: 'Large Yi. Strong bilingual, no native tools.',
  },

  // —— Granite (IBM, code-focused) ——
  {
    id: 'granite3.1-dense:8b',
    name: 'Granite 3.1 8B',
    sizeGB: 4.9,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 85,
    toolsCapable: true,
    tags: ['general', 'code'],
    description: "IBM's enterprise-tuned model. Tool calling.",
  },
  {
    id: 'granite-code:8b',
    name: 'Granite Code 8B',
    sizeGB: 4.6,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 90,
    toolsCapable: false,
    tags: ['code'],
    description: 'IBM code specialist. Trained on 116 languages.',
  },

  // —— DeepSeek extras ——
  {
    id: 'deepseek-coder:6.7b',
    name: 'DeepSeek Coder 6.7B',
    sizeGB: 3.8,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 105,
    toolsCapable: false,
    tags: ['code'],
    description: 'Legacy DeepSeek coder. Compact + competent.',
  },
  {
    id: 'deepseek-coder-v2:16b',
    name: 'DeepSeek Coder v2 16B (MoE)',
    sizeGB: 8.9,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 80,
    toolsCapable: false,
    tags: ['code'],
    description: 'MoE coder — fast at quality. No native tools.',
  },
  {
    id: 'deepseek-r1:70b',
    name: 'DeepSeek R1 70B',
    sizeGB: 40.0,
    quality: 5,
    qualityTier: 'flagship',
    estTokPerSecGpu: 12,
    toolsCapable: false,
    tags: ['reasoning'],
    description: 'Top open reasoning model. Needs 48 GB+ VRAM.',
  },

  // —— Vision extras ——
  {
    id: 'llama3.2-vision:11b',
    name: 'Llama 3.2 Vision 11B',
    sizeGB: 7.9,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 65,
    toolsCapable: false,
    tags: ['vision'],
    description: 'Meta vision-language model. Good for charts/screens.',
  },
  {
    id: 'qwen2.5-vl:7b',
    name: 'Qwen 2.5 VL 7B',
    sizeGB: 4.7,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 85,
    toolsCapable: false,
    tags: ['vision'],
    description: 'Qwen multimodal — strong at OCR + UI reads.',
  },
  {
    id: 'minicpm-v:8b',
    name: 'MiniCPM-V 8B',
    sizeGB: 5.5,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 75,
    toolsCapable: false,
    tags: ['vision'],
    description: 'Efficient multimodal — competitive with much larger VL models.',
  },

  // —— Vision ——
  {
    id: 'llava:7b',
    name: 'LLaVA 7B',
    sizeGB: 4.7,
    quality: 3,
    qualityTier: 'good',
    estTokPerSecGpu: 80,
    toolsCapable: false,
    tags: ['vision'],
    description: 'Image-capable small model. Read screenshots, describe images.',
  },
  {
    id: 'llava:13b',
    name: 'LLaVA 13B',
    sizeGB: 8.0,
    quality: 4,
    qualityTier: 'great',
    estTokPerSecGpu: 60,
    toolsCapable: false,
    tags: ['vision'],
    description: 'Better vision understanding. Needs 10GB+ VRAM.',
  },
];

export interface ModelFit {
  model: ModelInfo;
  fit: FitMode;
  /** Estimated tokens per second on this hardware. */
  estTokPerSec: number;
  /** 0-100 overall recommendation score. */
  score: number;
  /** Why this model was scored as it was — shown in UI. */
  reason: string;
}

/**
 * GPU memory overhead for OS / framework — leave 1.5GB headroom.
 */
const VRAM_HEADROOM_GB = 1.5;
/**
 * CPU-only inference roughly 1/10 GPU speed for a fit-in-RAM model.
 * Partial offload is somewhere in between — use 1/4.
 */
const CPU_SPEED_FRACTION = 0.1;
const PARTIAL_SPEED_FRACTION = 0.25;

export interface CloudAvailability {
  anthropic: boolean;
  openai: boolean;
  gemini: boolean;
  perplexity: boolean;
  groq: boolean;
  mistral: boolean;
  xai: boolean;
}

export const EMPTY_CLOUD: CloudAvailability = {
  anthropic: false,
  openai: false,
  gemini: false,
  perplexity: false,
  groq: false,
  mistral: false,
  xai: false,
};

export function scoreCatalog(
  hw: HardwareInfo,
  cloudAvailable: CloudAvailability = EMPTY_CLOUD,
): ModelFit[] {
  const vramAvailable = Math.max(0, hw.primaryVramGB - VRAM_HEADROOM_GB);
  const ramAvailable = Math.max(0, hw.ramGB - 4);
  // Scale GPU-bound estimates to the user's actual detected GPU. Decode speed
  // is bandwidth-bound, captured by hw.perfFactor (1.0 = reference GPU).
  const gpuSpeed = (base: number): number =>
    Math.max(1, Math.round(base * (hw.perfFactor || 1)));

  return CATALOG.map((m) => {
    let fit: FitMode;
    let estTokPerSec: number;
    let reason: string;

    if (m.cloud) {
      const keyed = cloudAvailable[m.cloud];
      if (keyed) {
        fit = 'cloud';
        estTokPerSec = m.estTokPerSecGpu; // cloud speed is independent of local GPU
        reason = `Cloud model via ${m.cloud} API. No local hardware needed.`;
      } else {
        fit = 'no';
        estTokPerSec = 0;
        reason = `${m.cloud} API key not set in Settings.`;
      }
    } else if (vramAvailable >= m.sizeGB) {
      fit = 'gpu';
      estTokPerSec = gpuSpeed(m.estTokPerSecGpu);
      reason = `Fits fully in VRAM (${m.sizeGB.toFixed(1)}/${vramAvailable.toFixed(1)} GB).`;
    } else if (vramAvailable >= m.sizeGB * 0.5 && ramAvailable >= m.sizeGB) {
      fit = 'partial';
      estTokPerSec = gpuSpeed(m.estTokPerSecGpu * PARTIAL_SPEED_FRACTION);
      reason = `Partial GPU offload (${vramAvailable.toFixed(1)} GB VRAM). Slower.`;
    } else if (ramAvailable >= m.sizeGB) {
      fit = 'cpu';
      estTokPerSec = Math.max(1, Math.round(m.estTokPerSecGpu * CPU_SPEED_FRACTION));
      reason = `CPU only — slow (${m.sizeGB.toFixed(1)} GB needed, ${ramAvailable.toFixed(1)} GB RAM free).`;
    } else {
      fit = 'no';
      estTokPerSec = 0;
      reason = `Not enough memory (${m.sizeGB.toFixed(1)} GB needed).`;
    }

    let score = 0;
    if (fit === 'no') {
      score = 0;
    } else {
      score += m.quality * 10;
      score += Math.min(25, Math.round(estTokPerSec / 4));
      score += m.toolsCapable ? 10 : 0;
      // Local GPU + cloud both get the top fit bonus
      score += fit === 'gpu' || fit === 'cloud' ? 15 : fit === 'partial' ? 7 : 0;
    }

    return { model: m, fit, estTokPerSec, score, reason };
  });
}

/**
 * Pick top recommendations across categories:
 * - 1 best balanced (general, tools)
 * - 1 best code (code-tagged)
 * - 1 best fast (small + speed)
 * Falls back to overall top if a category has no fit.
 */
export interface RecommendationSet {
  balanced: ModelFit | null;
  code: ModelFit | null;
  fast: ModelFit | null;
  top: ModelFit[];
}

export function recommend(scored: ModelFit[]): RecommendationSet {
  const runnable = scored.filter((s) => s.fit !== 'no');
  const sortedByScore = [...runnable].sort((a, b) => b.score - a.score);

  const balanced =
    runnable
      .filter((s) => s.model.tags.includes('general') && s.model.toolsCapable)
      .sort((a, b) => b.score - a.score)[0] ?? null;

  const code =
    runnable
      .filter((s) => s.model.tags.includes('code'))
      .sort((a, b) => b.score - a.score)[0] ?? null;

  const fast =
    runnable
      .filter((s) => s.model.tags.includes('small') || s.estTokPerSec >= 120)
      .sort((a, b) => b.score - a.score)[0] ?? null;

  return {
    balanced,
    code,
    fast,
    top: sortedByScore.slice(0, 5),
  };
}
