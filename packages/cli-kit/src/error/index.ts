export {
  CLIError,
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  ValidationError,
  ExitCode,
  toStructuredError,
} from './types.js';
export type { StructuredError, ExitCodeValue } from './types.js';
export { handleError } from './handler.js';
