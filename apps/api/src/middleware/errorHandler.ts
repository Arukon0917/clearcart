import type { ErrorRequestHandler } from "express";
import { HttpError } from "../errors";

/** Every error leaves as `{ error: { code, message, fields? } }`; stack traces stay in the server log. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    if (err.retryAfter) res.set("Retry-After", String(err.retryAfter));
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) } });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "That request is too large." } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "The request body isn't valid JSON." } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
};
