import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(
  requestOverrides: Record<string, unknown> = {},
): { host: ArgumentsHost; jsonMock: jest.Mock; statusMock: jest.Mock; setHeaderMock: jest.Mock; getHeaderMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnThis();
  const setHeaderMock = jest.fn();
  const getHeaderMock = jest.fn().mockReturnValue(undefined);

  const mockResponse = {
    status: statusMock,
    json: jsonMock,
    setHeader: setHeaderMock,
    getHeader: getHeaderMock,
  };
  const mockRequest = { requestId: 'test-request-id', ...requestOverrides };

  const host = {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;

  return { host, jsonMock, statusMock, setHeaderMock, getHeaderMock };
}

describe('HttpExceptionFilter', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('success field is always false', () => {
    it('returns success: false for HttpException', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });

    it('returns success: false for generic Error', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('boom'), host);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });
  });

  describe('HTTP status codes', () => {
    it('uses 404 status for NotFoundException', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, statusMock } = makeHost();
      filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('uses 500 status for unhandled Error', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, statusMock } = makeHost();
      filter.catch(new Error('unhandled'), host);
      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  describe('UPPER_SNAKE_CASE error codes', () => {
    it('maps 400 to BAD_REQUEST by default', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('bad', HttpStatus.BAD_REQUEST), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('BAD_REQUEST');
    });

    it('maps 401 to UNAUTHORIZED', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('unauth', HttpStatus.UNAUTHORIZED), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('maps 403 to FORBIDDEN', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('forbidden', HttpStatus.FORBIDDEN), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('FORBIDDEN');
    });

    it('maps 429 to RATE_LIMIT_EXCEEDED', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('rate', HttpStatus.TOO_MANY_REQUESTS), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('maps 500 to INTERNAL_SERVER_ERROR for unknown error', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('crash'), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('uses VALIDATION_ERROR code when NestJS sends an array of messages (ValidationPipe)', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      // BadRequestException with array message is what ValidationPipe throws
      filter.catch(
        new BadRequestException({ message: ['field must not be empty'], error: 'Bad Request' }),
        host,
      );
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details).toEqual({
        validationErrors: ['field must not be empty'],
      });
    });

    it('honours custom UPPER_SNAKE_CASE code from the exception payload', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(
        new HttpException({ code: 'REPLAY_DETECTED', message: 'Duplicate nonce' }, HttpStatus.CONFLICT),
        host,
      );
      const body = jsonMock.mock.calls[0][0];
      expect(body.code).toBe('REPLAY_DETECTED');
      expect(body.message).toBe('Duplicate nonce');
    });
  });

  describe('stack trace suppression', () => {
    it('does NOT include stack in production', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('boom'), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.details).toBeUndefined();
    });

    it('INCLUDES stack in development', () => {
      process.env.NODE_ENV = 'development';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('boom'), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.details).toBeDefined();
      expect(body.details.stack).toBeDefined();
    });

    it('generic error message is sanitized in production', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('secret internal detail'), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.message).toBe('An unexpected internal error occurred');
    });

    it('generic error message is NOT sanitized in development', () => {
      process.env.NODE_ENV = 'development';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new Error('secret internal detail'), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body.message).toBe('secret internal detail');
    });
  });

  describe('response structure', () => {
    it('always includes success, code, and message fields', () => {
      process.env.NODE_ENV = 'production';
      const filter = new HttpExceptionFilter();
      const { host, jsonMock } = makeHost();
      filter.catch(new HttpException('oops', HttpStatus.INTERNAL_SERVER_ERROR), host);
      const body = jsonMock.mock.calls[0][0];
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
    });
  });
});
