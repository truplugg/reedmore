/** One error shape for the whole API, so the client never has to guess. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) { super(message); this.name = 'ApiError'; }
}

export const badRequest   = (code: string, m: string, d?: unknown) => new ApiError(400, code, m, d);
export const unauthorized = (m = 'You need to sign in.')            => new ApiError(401, 'unauthorized', m);
export const forbidden    = (m = 'You do not have access to this.') => new ApiError(403, 'forbidden', m);
export const notFound     = (m = 'Not found.')                      => new ApiError(404, 'not_found', m);
export const conflict     = (code: string, m: string)               => new ApiError(409, code, m);
export const gone         = (m = 'No longer available.')            => new ApiError(410, 'gone', m);
export const tooMany      = (m = 'Too many attempts. Try again later.') => new ApiError(429, 'rate_limited', m);
