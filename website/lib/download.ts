export type Variant = 'setup' | 'portable';

export function isVariant(s: string): s is Variant {
  return s === 'setup' || s === 'portable';
}
