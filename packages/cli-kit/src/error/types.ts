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
  exitCode: ExitCodeValue;
}

export class CLIError extends Error {
  public errorType: string;
  public retryable: boolean;
  public hint?: string;
  public exitCode: ExitCodeValue;

  constructor(
    message: string,
    options?: {
      suggestion?: string;
      type?: string;
      retryable?: boolean;
      exitCode?: ExitCodeValue;
    },
  ) {
    super(message);
    this.name = 'CLIError';
    this.errorType = options?.type ?? 'general_error';
    this.retryable = options?.retryable ?? false;
    this.hint = options?.suggestion;
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
      exitCode: this.exitCode,
    };
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
  constructor(message: string) {
    super(message, {
      suggestion: 'Check your internet connection and try again.',
      type: 'network_error',
      retryable: true,
      exitCode: ExitCode.NETWORK,
    });
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends CLIError {
  constructor(message = 'Rate limited. Try again in a few seconds.') {
    super(message, {
      suggestion: 'Wait a few seconds and retry.',
      type: 'rate_limited',
      retryable: true,
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
