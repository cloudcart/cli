/** Semantic exit codes for AI agents to distinguish error classes */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  AUTH: 4,
  CONFLICT: 5,
  RATE_LIMITED: 6,
  NETWORK: 7,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Structured error type for machine-readable output */
export interface StructuredError {
  type: string;
  message: string;
  retryable: boolean;
  hint?: string;
  /** How long the store asked to wait before the next try (its `Retry-After`) */
  retryAfterSeconds?: number;
  exitCode: ExitCodeValue;
}

export class CLIError extends Error {
  public errorType: string;
  public retryable: boolean;
  public hint?: string;
  public retryAfterSeconds?: number;
  public exitCode: ExitCodeValue;

  constructor(
    message: string,
    options?: {
      suggestion?: string;
      type?: string;
      retryable?: boolean;
      retryAfterSeconds?: number;
      exitCode?: ExitCodeValue;
    },
  ) {
    super(message);
    this.name = 'CLIError';
    this.errorType = options?.type ?? 'general_error';
    this.retryable = options?.retryable ?? false;
    this.hint = options?.suggestion;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.exitCode = options?.exitCode ?? ExitCode.GENERAL;
  }

  /** Legacy getter for backward compatibility */
  get suggestion(): string | undefined {
    return this.hint;
  }

  toStructured(): StructuredError {
    return {
      type: this.errorType,
      message: this.message,
      retryable: this.retryable,
      hint: this.hint,
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
      exitCode: this.exitCode,
    };
  }
}

/**
 * A mutation that failed by a timeout, a 502, 503 or 504, or a connection that broke once the request had gone may have
 * run on the store before the answer was lost, so it is never marked retryable: sending it again could do its work
 * twice (B-549, B-553).
 */
export const MUTATION_MAY_HAVE_RUN =
  'The mutation may have run before the answer was lost: read the record before sending it again.';

export class TimeoutError extends CLIError {
  constructor(seconds: number, options?: { mutation?: boolean }) {
    super(`The store did not answer within ${seconds} s.`, {
      suggestion: options?.mutation
        ? MUTATION_MAY_HAVE_RUN
        : 'Try again; `app execute --timeout <seconds>` waits longer for a heavy query.',
      type: 'timeout',
      retryable: !options?.mutation,
      exitCode: ExitCode.NETWORK,
    });
    this.name = 'TimeoutError';
  }
}

/** A 502, 503 or 504: the store, or what stands in front of it, could not answer for now. */
export class ServerUnavailableError extends CLIError {
  constructor(message: string, options?: { mutation?: boolean; retryAfterSeconds?: number }) {
    super(message, {
      suggestion: options?.mutation ? MUTATION_MAY_HAVE_RUN : 'Try again in a moment.',
      type: 'server_unavailable',
      retryable: !options?.mutation,
      retryAfterSeconds: options?.retryAfterSeconds,
      exitCode: ExitCode.NETWORK,
    });
    this.name = 'ServerUnavailableError';
  }
}

export class AuthenticationError extends CLIError {
  constructor(message = 'Authentication required. Run `cloudcart auth login`.') {
    super(message, {
      suggestion: 'Run `cloudcart auth login` to authenticate, or set CLOUDCART_CLI_TOKEN env var.',
      type: 'auth_required',
      retryable: false,
      exitCode: ExitCode.AUTH,
    });
    this.name = 'AuthenticationError';
  }
}

export class ConfigurationError extends CLIError {
  constructor(message: string) {
    super(message, {
      type: 'configuration_error',
      retryable: false,
      exitCode: ExitCode.USAGE,
    });
    this.name = 'ConfigurationError';
  }
}

export class NetworkError extends CLIError {
  /** `mayHaveRun`: a mutation whose connection broke once the request may have reached the store (B-553). */
  constructor(message: string, options?: { mayHaveRun?: boolean }) {
    super(message, {
      suggestion: options?.mayHaveRun
        ? MUTATION_MAY_HAVE_RUN
        : 'Check your internet connection and try again.',
      type: 'network_error',
      retryable: !options?.mayHaveRun,
      exitCode: ExitCode.NETWORK,
    });
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends CLIError {
  constructor(retryAfterSeconds?: number) {
    const wait = retryAfterSeconds === undefined ? 'a few seconds' : `${retryAfterSeconds} s`;
    super(`Rate limited. Try again in ${wait}.`, {
      suggestion: `Wait ${wait} and retry.`,
      type: 'rate_limited',
      retryable: true,
      retryAfterSeconds,
      exitCode: ExitCode.RATE_LIMITED,
    });
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, hint?: string) {
    super(message, {
      suggestion: hint,
      type: 'validation_error',
      retryable: false,
      exitCode: ExitCode.USAGE,
    });
    this.name = 'ValidationError';
  }
}

/** Convert any error to a structured error for JSON output */
export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof CLIError) {
    return error.toStructured();
  }
  if (error instanceof Error) {
    return {
      type: 'unexpected_error',
      message: error.message,
      retryable: false,
      exitCode: ExitCode.GENERAL,
    };
  }
  return {
    type: 'unexpected_error',
    message: String(error),
    retryable: false,
    exitCode: ExitCode.GENERAL,
  };
}
