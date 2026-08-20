import { z } from "zod";

import { sourceReferenceSchema } from "./SourceReferenceSchema.js";

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const captureObservationInputSchema = z.object({
  source: sourceReferenceSchema,

  publishedAt: z.date().optional(),

	title: optionalTrimmedString,
	displayedCompanyName: optionalTrimmedString,
	locationText: optionalTrimmedString,
	description: optionalTrimmedString,
	salaryText: optionalTrimmedString,
	contractText: optionalTrimmedString,
	contactText: optionalTrimmedString,
	rawContent: optionalTrimmedString,

  metadata: z.record(z.string(), z.unknown()).optional(),
});
