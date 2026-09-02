describe('rate_limit_store', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  // --- in-memory backend (REDIS_HOST unset) --------------------------------

  function loadMemory() {
    jest.resetModules();
    const env = Object.assign({}, OLD_ENV);
    delete env.REDIS_HOST;
    process.env = env;
    return require('../../app/rate_limit_store');
  }

  test('falls back to the in-memory backend when REDIS_HOST is unset', () => {
    const store = loadMemory();
    expect(store.backend).toBe('memory');
  });

  test('memory backend: allows a burst then drops, and _memoryReset clears it', () => {
    const store = loadMemory();
    let chain = Promise.resolve();
    // b=15, cost=3 -> 5 allowed
    for (let i = 0; i < 5; i++) {
      chain = chain.then(() => store.consume('ip:a', 1000));
    }
    return chain
      .then(() => store.consume('ip:a', 1000))
      .then(dropped => {
        expect(dropped).toEqual({ allowed: false, retryAfter: 3 });
        return store.consume('ip:b', 1000);
      })
      .then(other => {
        expect(other.allowed).toBe(true);
        store._memoryReset();
        return store.consume('ip:a', 1000);
      })
      .then(afterReset => expect(afterReset.allowed).toBe(true));
  });

  test('memory backend: connect() is a no-op that resolves', () => {
    const store = loadMemory();
    return store.connect(); // must not throw / reject
  });

  // --- Redis backend (REDIS_HOST set, redis lib mocked) -------------------

  function loadRedis(evalImpl) {
    jest.resetModules();
    process.env = Object.assign({}, OLD_ENV, {
      REDIS_HOST: 'redis.example',
      REDIS_PORT: '19512',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: 'secret-from-env'
    });
    const client = {
      connect: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
      eval: jest.fn(evalImpl)
    };
    const createClient = jest.fn(() => client);
    jest.doMock('redis', () => ({ createClient }));
    const store = require('../../app/rate_limit_store');
    return { store, client, createClient };
  }

  test('redis backend: builds the client from env and runs the Lua script', () => {
    const { store, client, createClient } = loadRedis(() =>
      Promise.resolve([1, 9, 0])
    );

    expect(store.backend).toBe('redis');

    return store.consume('ip:1.2.3.4', 1000).then(result => {
      expect(result).toEqual({ allowed: true, retryAfter: 3 });

      expect(createClient).toHaveBeenCalledWith({
        username: 'default',
        password: 'secret-from-env',
        socket: { host: 'redis.example', port: 19512 }
      });
      expect(client.connect).toHaveBeenCalledTimes(1);

      const [script, options] = client.eval.mock.calls[0];
      expect(script).toContain('HMGET');
      expect(options.keys).toEqual(['rl:ip:1.2.3.4']);
      // now, r, b, cost, ttlMs
      expect(options.arguments).toEqual(['1000', '1', '15', '3', '15000']);
    });
  });

  test('redis backend: defaults username to "default" and port to 6379', () => {
    jest.resetModules();
    const env = Object.assign({}, OLD_ENV, {
      REDIS_HOST: 'redis.example',
      REDIS_PASSWORD: 'secret-from-env'
    });
    delete env.REDIS_USERNAME;
    delete env.REDIS_PORT;
    process.env = env;
    const client = {
      connect: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
      eval: jest.fn(() => Promise.resolve([1, 9, 0]))
    };
    const createClient = jest.fn(() => client);
    jest.doMock('redis', () => ({ createClient }));

    return require('../../app/rate_limit_store')
      .consume('ip:x', 1000)
      .then(() => {
        expect(createClient).toHaveBeenCalledWith({
          username: 'default',
          password: 'secret-from-env',
          socket: { host: 'redis.example', port: 6379 }
        });
      });
  });

  test('redis backend: a script that returns allowed=0 forwards its retry hint', () => {
    const { store } = loadRedis(() => Promise.resolve([0, 0, 5]));
    return store.consume('ip:x', 1000).then(result => {
      expect(result).toEqual({ allowed: false, retryAfter: 5 });
    });
  });

  test('redis backend: fails closed when the Redis call rejects', () => {
    const { store } = loadRedis(() =>
      Promise.reject(new Error('ECONNREFUSED'))
    );
    return store.consume('ip:x', 1000).then(result => {
      expect(result).toEqual({
        allowed: false,
        redisDown: true,
        retryAfter: 3
      });
    });
  });

  test('redis backend: connects only once across calls', () => {
    const { store, client } = loadRedis(() => Promise.resolve([1, 9, 0]));
    return store
      .consume('ip:x', 1000)
      .then(() => store.consume('ip:x', 2000))
      .then(() => {
        expect(client.connect).toHaveBeenCalledTimes(1);
        expect(client.eval).toHaveBeenCalledTimes(2);
      });
  });

  test('redis backend: fails closed when the connection itself fails, and retries next time', () => {
    const { store, client } = loadRedis(() => Promise.resolve([1, 9, 0]));
    client.connect
      .mockImplementationOnce(() => Promise.reject(new Error('ETIMEDOUT')))
      .mockImplementationOnce(() => Promise.resolve());

    return store
      .consume('ip:x', 1000)
      .then(result => {
        expect(result).toEqual({
          allowed: false,
          redisDown: true,
          retryAfter: 3
        });
        // the failed connect promise was cleared, so a later call tries again
        return store.consume('ip:x', 2000);
      })
      .then(result => {
        expect(result.allowed).toBe(true);
        expect(client.connect).toHaveBeenCalledTimes(2);
      });
  });

  test('redis backend: the client error handler just logs (no throw)', () => {
    const { store, client } = loadRedis(() => Promise.resolve([1, 9, 0]));
    return store.consume('ip:x', 1000).then(() => {
      const errorHandler = client.on.mock.calls.find(
        call => call[0] === 'error'
      )[1];
      expect(() => errorHandler(new Error('connection reset'))).not.toThrow();
    });
  });
});
