import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { targetSchema } from '../result';
export { identityLabel } from '../simulator';

export const contextSchema = z.strictObject({ attemptId: z.uuid(), target: targetSchema,
  ledgerFile: z.string().refine(isAbsolute), abortFile: z.string().refine(isAbsolute),
  cache: z.union([z.literal('off'), z.strictObject({ mode: z.enum(['read-write', 'read-only']), dir: z.string().refine(isAbsolute), strict: z.boolean() })]).default('off'),
});
export function runtimeContext() {
  const file = process.env.TESTERARMY_CONTEXT;
  if (!file || !isAbsolute(file)) throw new Error('A controller-validated installed build context is required.');
  const context = contextSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (context.target.kind !== 'acceptance') throw new Error('TesterArmy requires frozen original issue acceptance.');
  return context;
}
