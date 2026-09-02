describe('firebase_db', () => {
  const OLD_ENV = process.env;

  let mockSet;
  let mockGet;
  let mockRemove;
  let mockRef;
  let mockGetDatabase;
  let mockInitializeApp;
  let mockApplicationDefault;
  let mockGetApps;

  function loadModule() {
    mockSet = jest.fn(() => Promise.resolve());
    mockGet = jest.fn(() => Promise.resolve({ val: () => null }));
    mockRemove = jest.fn(() => Promise.resolve());
    mockRef = jest.fn(() => ({ set: mockSet, get: mockGet, remove: mockRemove }));
    mockGetDatabase = jest.fn(() => ({ ref: mockRef }));
    mockInitializeApp = jest.fn(() => ({ name: 'app' }));
    mockApplicationDefault = jest.fn(() => 'default-credential');

    jest.doMock('firebase-admin/app', () => ({
      initializeApp: mockInitializeApp,
      applicationDefault: mockApplicationDefault,
      getApps: mockGetApps
    }));
    jest.doMock('firebase-admin/database', () => ({ getDatabase: mockGetDatabase }));

    return require('../../app/firebase_db');
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = Object.assign({}, OLD_ENV);
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('initializes the app and writes the job under the configured profile path', () => {
    process.env.FIREBASE_DB_URL = 'https://custom.example';
    process.env.FIREBASE_PROFILE = 'alice';
    process.env.GCS_BUCKET = 'custom-bucket';
    mockGetApps = jest.fn(() => []);

    const firebaseDb = loadModule();

    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: 'default-credential',
      databaseURL: 'https://custom.example'
    });

    return firebaseDb
      .saveJob('sunset, beach', 'zips/abc-123.zip', 'https://signed.example/abc.zip')
      .then(path => {
        const refPath = mockRef.mock.calls[0][0];

        expect(path).toBe(refPath);
        expect(refPath).toMatch(/^\/alice\/.+\/abc-123-zip$/);
        // dots (ISO milliseconds + file extension) must be gone from the key
        expect(refPath).not.toMatch(/\./);

        const value = mockSet.mock.calls[0][0];
        expect(value).toMatchObject({
          tags: 'sunset, beach',
          storagePath: 'zips/abc-123.zip',
          gsUri: 'gs://custom-bucket/zips/abc-123.zip',
          downloadUrl: 'https://signed.example/abc.zip'
        });
        expect(typeof value.createdAt).toBe('number');
      });
  });

  test('listJobs flattens the profile tree and sorts newest first', () => {
    process.env.FIREBASE_PROFILE = 'alice';
    mockGetApps = jest.fn(() => []);

    const firebaseDb = loadModule();

    mockGet.mockImplementationOnce(() =>
      Promise.resolve({
        val: () => ({
          '2026-01-01T00-00-00-000Z': {
            'a-zip': {
              tags: 'old',
              storagePath: 'zips/a.zip',
              gsUri: 'gs://b/zips/a.zip',
              downloadUrl: 'u1',
              createdAt: 100
            }
          },
          '2026-02-02T00-00-00-000Z': {
            'b-zip': {
              tags: 'new',
              storagePath: 'zips/b.zip',
              gsUri: 'gs://b/zips/b.zip',
              downloadUrl: 'u2',
              createdAt: 200
            }
          }
        })
      })
    );

    return firebaseDb.listJobs().then(jobs => {
      expect(mockRef).toHaveBeenCalledWith('/alice');
      expect(jobs).toEqual([
        {
          tags: 'new',
          storagePath: 'zips/b.zip',
          gsUri: 'gs://b/zips/b.zip',
          downloadUrl: 'u2',
          createdAt: 200
        },
        {
          tags: 'old',
          storagePath: 'zips/a.zip',
          gsUri: 'gs://b/zips/a.zip',
          downloadUrl: 'u1',
          createdAt: 100
        }
      ]);
    });
  });

  test('listJobs returns an empty list when nothing is stored', () => {
    mockGetApps = jest.fn(() => []);
    const firebaseDb = loadModule();
    return firebaseDb.listJobs().then(jobs => expect(jobs).toEqual([]));
  });

  test('reuses an existing app and falls back to default config', () => {
    delete process.env.FIREBASE_DB_URL;
    delete process.env.FIREBASE_PROFILE;
    delete process.env.GCS_BUCKET;
    const existingApp = { name: 'existing' };
    mockGetApps = jest.fn(() => [existingApp]);

    const firebaseDb = loadModule();

    expect(mockInitializeApp).not.toHaveBeenCalled();

    return firebaseDb.saveJob('x', 'zips/f.zip', 'https://signed.example/f.zip').then(() => {
      expect(mockGetDatabase).toHaveBeenCalledWith(existingApp);
      expect(mockRef.mock.calls[0][0]).toMatch(/^\/pierrelouis\//);
      expect(mockSet.mock.calls[0][0].gsUri).toBe('gs://ecni22026bucket/zips/f.zip');
      expect(mockSet.mock.calls[0][0].downloadUrl).toBe('https://signed.example/f.zip');
    });
  });
});
