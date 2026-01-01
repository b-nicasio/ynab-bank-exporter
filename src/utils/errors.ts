/**
 * Error handling utilities and error types
 */

export enum ErrorType {
  // Transient errors - should retry
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR', // 5xx errors

  // Permanent errors - don't retry
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  PARSING_ERROR = 'PARSING_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ErrorDetails {
  type: ErrorType;
  message: string;
  originalError?: any;
  context?: Record<string, any>;
  retryable: boolean;
  httpStatus?: number;
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly retryable: boolean;
  public readonly context?: Record<string, any>;
  public readonly httpStatus?: number;
  public readonly originalError?: any;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'AppError';
    this.type = details.type;
    this.retryable = details.retryable;
    this.context = details.context;
    this.httpStatus = details.httpStatus;
    this.originalError = details.originalError;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON() {
    return {
      type: this.type,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      httpStatus: this.httpStatus,
    };
  }
}

/**
 * Classify an error and create an AppError
 */
export function classifyError(error: any, context?: Record<string, any>): AppError {
  // If it's already an AppError, return it
  if (error instanceof AppError) {
    return error;
  }

  // Check for HTTP errors
  if (error.response) {
    const status = error.response.status || error.response.statusCode;
    const data = error.response.data;

    // Rate limiting (429)
    if (status === 429) {
      return new AppError({
        type: ErrorType.RATE_LIMIT,
        message: `Rate limit exceeded: ${data?.error?.detail || error.message}`,
        retryable: true,
        httpStatus: status,
        context: {
          ...context,
          retryAfter: error.response.headers?.['retry-after'],
        },
        originalError: error,
      });
    }

    // Authentication errors (401, 403)
    if (status === 401 || status === 403) {
      return new AppError({
        type: ErrorType.AUTHENTICATION_ERROR,
        message: `Authentication failed: ${data?.error?.detail || error.message}`,
        retryable: false,
        httpStatus: status,
        context,
        originalError: error,
      });
    }

    // Not found (404)
    if (status === 404) {
      return new AppError({
        type: ErrorType.NOT_FOUND,
        message: `Resource not found: ${data?.error?.detail || error.message}`,
        retryable: false,
        httpStatus: status,
        context,
        originalError: error,
      });
    }

    // Validation errors (400, 422)
    if (status === 400 || status === 422) {
      return new AppError({
        type: ErrorType.VALIDATION_ERROR,
        message: `Validation error: ${data?.error?.detail || JSON.stringify(data)}`,
        retryable: false,
        httpStatus: status,
        context: {
          ...context,
          validationErrors: data?.error?.detail,
        },
        originalError: error,
      });
    }

    // Server errors (5xx) - retryable
    if (status >= 500) {
      return new AppError({
        type: ErrorType.SERVER_ERROR,
        message: `Server error (${status}): ${data?.error?.detail || error.message}`,
        retryable: true,
        httpStatus: status,
        context,
        originalError: error,
      });
    }
  }

  // Network/timeout errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return new AppError({
      type: ErrorType.NETWORK_ERROR,
      message: `Network error: ${error.message}`,
      retryable: true,
      context,
      originalError: error,
    });
  }

  if (error.message?.includes('timeout') || error.message?.includes('TIMEOUT')) {
    return new AppError({
      type: ErrorType.TIMEOUT,
      message: `Request timeout: ${error.message}`,
      retryable: true,
      context,
      originalError: error,
    });
  }

  // Configuration errors
  if (error.message?.includes('not found') || error.message?.includes('required')) {
    return new AppError({
      type: ErrorType.CONFIGURATION_ERROR,
      message: error.message,
      retryable: false,
      context,
      originalError: error,
    });
  }

  // Unknown error
  return new AppError({
    type: ErrorType.UNKNOWN_ERROR,
    message: error.message || 'Unknown error occurred',
    retryable: false,
    context,
    originalError: error,
  });
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    onRetry?: (error: AppError, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: AppError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const appError = classifyError(error);
      lastError = appError;

      // Don't retry if error is not retryable
      if (!appError.retryable) {
        throw appError;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw appError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      if (onRetry) {
        onRetry(appError, attempt + 1);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Format error for logging
 */
export function formatError(error: any): string {
  if (error instanceof AppError) {
    const parts = [
      `[${error.type}] ${error.message}`,
      error.context ? `Context: ${JSON.stringify(error.context)}` : '',
      error.httpStatus ? `HTTP ${error.httpStatus}` : '',
    ].filter(Boolean);
    return parts.join(' | ');
  }

  if (error.response) {
    const status = error.response.status || error.response.statusCode;
    const data = error.response.data;
    return `HTTP ${status}: ${JSON.stringify(data)}`;
  }

  return error.message || String(error);
}

