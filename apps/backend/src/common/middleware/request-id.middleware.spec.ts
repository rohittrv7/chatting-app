import { Request, Response } from 'express';
import { RequestIdMiddleware, REQUEST_ID_HEADER } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  function makeReqRes() {
    const headers: Record<string, string> = {};
    const req = {} as Request & { requestId?: string };
    const res = {
      setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }),
      getHeader: jest.fn((name: string) => headers[name]),
    } as unknown as Response;
    const next = jest.fn();
    return { req, res, next, headers };
  }

  it('attaches a requestId property to req', () => {
    const { req, res, next } = makeReqRes();
    middleware.use(req, res, next);
    expect((req as { requestId: string }).requestId).toBeDefined();
    expect(typeof (req as { requestId: string }).requestId).toBe('string');
  });

  it('generates a valid UUIDv4 requestId', () => {
    const { req, res, next } = makeReqRes();
    middleware.use(req, res, next);
    const uuidV4Pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect((req as { requestId: string }).requestId).toMatch(uuidV4Pattern);
  });

  it(`sets the ${REQUEST_ID_HEADER} response header`, () => {
    const { req, res, next, headers } = makeReqRes();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      expect.any(String),
    );
    expect(headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  it('requestId on req matches the value set in the response header', () => {
    const { req, res, next, headers } = makeReqRes();
    middleware.use(req, res, next);
    expect((req as { requestId: string }).requestId).toBe(headers[REQUEST_ID_HEADER]);
  });

  it('generates a unique requestId for every request', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { req, res, next } = makeReqRes();
      middleware.use(req, res, next);
      ids.add((req as { requestId: string }).requestId!);
    }
    expect(ids.size).toBe(100);
  });

  it('calls next() after setting the requestId', () => {
    const { req, res, next } = makeReqRes();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
