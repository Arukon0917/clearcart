export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SELLER_CANNOT_PURCHASE"
  | "INTERNAL";

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
};

export interface FieldIssue {
  path: string;
  message: string;
}

/** Thrown anywhere in a handler; the error handler turns it into `{ error: { code, message, fields? } }`. */
export class HttpError extends Error {
  public readonly code: ErrorCode;

  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: FieldIssue[],
    code?: ErrorCode,
    /** Seconds; sent as the Retry-After header on 429s. */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.code = code ?? CODE_BY_STATUS[status] ?? "INTERNAL";
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

export const tooManyRequests = (retryAfter: number) => {
  const minutes = Math.ceil(retryAfter / 60);
  return new HttpError(
    429,
    `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    undefined,
    "RATE_LIMITED",
    retryAfter,
  );
};
