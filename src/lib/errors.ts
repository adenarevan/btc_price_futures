import { EngineError } from "./domain";
import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryable = false,
  ) {
    super(code);
  }
}
export class ConfigurationError extends AppError {
  constructor(public fields: string[]) {
    super("SERVER_CONFIG_INVALID", 503);
  }
}
export function safeError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof EngineError)
    return new AppError(error.code, error.code === "DATA_STALE" ? 409 : 400);
  if (error instanceof ZodError) return new AppError("INPUT_INVALID", 400);
  return new AppError("SERVICE_UNAVAILABLE", 503, true);
}
