import { describe, it, expect } from 'vitest';
import {
  CLIError,
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  ValidationError,
  ExitCode,
  toStructuredError,
} from './types.js';

describe('error types', () => {
  it('CLIError has name and optional suggestion', () => {
    const err = new CLIError('something broke', { suggestion: 'try again' });
    expect(err.name).toBe('CLIError');
    expect(err.message).toBe('something broke');
    expect(err.suggestion).toBe('try again');
  });

  it('CLIError has structured error properties', () => {
    const err = new CLIError('fail', {
      type: 'test_error',
      retryable: true,
      exitCode: ExitCode.NETWORK,
    });
    expect(err.errorType).toBe('test_error');
    expect(err.retryable).toBe(true);
    expect(err.exitCode).toBe(7);
  });

  it('CLIError.toStructured() returns machine-readable object', () => {
    const err = new CLIError('fail', {
      type: 'test_error',
      suggestion: 'retry',
      retryable: true,
      exitCode: ExitCode.NETWORK,
    });
    const s = err.toStructured();
    expect(s.type).toBe('test_error');
    expect(s.message).toBe('fail');
    expect(s.retryable).toBe(true);
    expect(s.hint).toBe('retry');
    expect(s.exitCode).toBe(7);
  });

  it('AuthenticationError has default message and suggestion', () => {
    const err = new AuthenticationError();
    expect(err.name).toBe('AuthenticationError');
    expect(err.message).toContain('auth login');
    expect(err.suggestion).toBeDefined();
    expect(err.errorType).toBe('auth_required');
    expect(err.exitCode).toBe(ExitCode.AUTH);
    expect(err.retryable).toBe(false);
  });

  it('ConfigurationError has correct type', () => {
    const err = new ConfigurationError('bad config');
    expect(err.name).toBe('ConfigurationError');
    expect(err.errorType).toBe('configuration_error');
    expect(err.exitCode).toBe(ExitCode.USAGE);
  });

  it('NetworkError is retryable', () => {
    const err = new NetworkError('timeout');
    expect(err.name).toBe('NetworkError');
    expect(err.suggestion).toContain('internet');
    expect(err.retryable).toBe(true);
    expect(err.exitCode).toBe(ExitCode.NETWORK);
  });

  it('RateLimitError is retryable', () => {
    const err = new RateLimitError();
    expect(err.retryable).toBe(true);
    expect(err.exitCode).toBe(ExitCode.RATE_LIMITED);
    expect(err.errorType).toBe('rate_limited');
  });

  it('ValidationError is not retryable', () => {
    const err = new ValidationError('bad field', 'Check spelling');
    expect(err.retryable).toBe(false);
    expect(err.hint).toBe('Check spelling');
    expect(err.exitCode).toBe(ExitCode.USAGE);
  });

  it('all errors are instances of CLIError and Error', () => {
    expect(new AuthenticationError()).toBeInstanceOf(CLIError);
    expect(new AuthenticationError()).toBeInstanceOf(Error);
    expect(new NetworkError('x')).toBeInstanceOf(CLIError);
    expect(new RateLimitError()).toBeInstanceOf(CLIError);
    expect(new ValidationError('x')).toBeInstanceOf(CLIError);
  });

  it('toStructuredError handles CLIError', () => {
    const s = toStructuredError(new NetworkError('fail'));
    expect(s.type).toBe('network_error');
    expect(s.retryable).toBe(true);
  });

  it('toStructuredError handles plain Error', () => {
    const s = toStructuredError(new Error('oops'));
    expect(s.type).toBe('unexpected_error');
    expect(s.retryable).toBe(false);
  });

  it('toStructuredError handles non-Error', () => {
    const s = toStructuredError('string error');
    expect(s.type).toBe('unexpected_error');
    expect(s.message).toBe('string error');
  });
});
