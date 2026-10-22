export {
  CLIError,
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  ServerUnavailableError,
  TimeoutError,
  ValidationError,
  MUTATION_MAY_HAVE_RUN,
  ExitCode,
  toStructuredError,
} from './types.js';
export type { StructuredError, ExitCodeValue } from './types.js';
export { handleError } from './handler.js';
