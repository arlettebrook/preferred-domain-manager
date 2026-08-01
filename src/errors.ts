export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: HeadersInit = {}) {
    super(message);
  }
}

export class LockBusyError extends Error {}
