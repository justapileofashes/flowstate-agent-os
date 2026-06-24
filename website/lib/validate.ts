import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(320);

export const waitlistSchema = z.object({
  email,
  source: z.string().trim().max(64).optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  message: z.string().trim().min(1).max(5000),
  website: z.string().max(200).optional(), // honeypot — accepted, handled by route
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
