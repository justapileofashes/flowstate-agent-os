export function signLicense(opts: {
  privateJwk: object;
  tier: 'free' | 'pro' | 'power';
  email?: string;
  days?: number;
  kid?: string;
  now?: number;
}): string;
