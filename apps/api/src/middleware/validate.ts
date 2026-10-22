import type { z } from "zod";
import { HttpError } from "../errors";

/** Parses untrusted input or throws a 400 with field-level issues the UI can show inline. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new HttpError(400, "Invalid request", issues);
  }
  return result.data;
}
