export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class LockBusyError extends Error {}

