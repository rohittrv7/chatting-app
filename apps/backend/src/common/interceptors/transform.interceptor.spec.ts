import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

function makeContext(requestOverrides: Record<string, unknown> = {}): ExecutionContext {
  const headers: Record<string, string> = {};
  const mockRequest = { requestId: 'test-uuid', ...requestOverrides };
  const mockResponse = {
    setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }),
    getHeader: jest.fn((name: string) => headers[name]),
  };

  return {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(data: unknown): CallHandler {
  return { handle: () => of(data) } as CallHandler;
}

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it('wraps data in the success envelope', (done) => {
    const ctx = makeContext();
    const handler = makeHandler({ id: 1, name: 'Alice' });

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, name: 'Alice' });
      done();
    });
  });

  it('sets message to "OK"', (done) => {
    const ctx = makeContext();
    const handler = makeHandler(null);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result.message).toBe('OK');
      done();
    });
  });

  it('includes a valid ISO 8601 timestamp', (done) => {
    const ctx = makeContext();
    const handler = makeHandler({});

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result.timestamp).toBeDefined();
      const ts = new Date(result.timestamp);
      expect(ts.toISOString()).toBe(result.timestamp);
      done();
    });
  });

  it('wraps null / undefined data correctly', (done) => {
    const ctx = makeContext();
    const handler = makeHandler(null);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      done();
    });
  });

  it('wraps array data correctly', (done) => {
    const ctx = makeContext();
    const handler = makeHandler([1, 2, 3]);

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result.data).toEqual([1, 2, 3]);
      done();
    });
  });

  it(`sets ${REQUEST_ID_HEADER} header when requestId is present and header not already set`, (done) => {
    const headers: Record<string, string> = {};
    const mockRequest = { requestId: 'my-uuid-1234' };
    const setHeaderMock = jest.fn((name: string, value: string) => { headers[name] = value; });
    const mockResponse = {
      setHeader: setHeaderMock,
      getHeader: jest.fn(() => undefined),
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    interceptor.intercept(ctx, makeHandler({})).subscribe(() => {
      expect(setHeaderMock).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'my-uuid-1234');
      done();
    });
  });

  it('does not overwrite an already-set X-Request-Id header', (done) => {
    const mockRequest = { requestId: 'new-uuid' };
    const setHeaderMock = jest.fn();
    const mockResponse = {
      setHeader: setHeaderMock,
      // Simulate header already set by middleware
      getHeader: jest.fn(() => 'existing-uuid'),
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    interceptor.intercept(ctx, makeHandler({})).subscribe(() => {
      expect(setHeaderMock).not.toHaveBeenCalled();
      done();
    });
  });
});
