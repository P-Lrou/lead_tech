const EventEmitter = require('events');

// --- mocks -----------------------------------------------------------------

jest.mock('https', () => ({ get: jest.fn() }));
jest.mock('archiver', () => jest.fn());

const mockGetSignedUrl = jest.fn(() => Promise.resolve(['https://signed.example/zip.zip']));
const mockCreateWriteStream = jest.fn();
const mockFile = jest.fn(() => ({
  createWriteStream: mockCreateWriteStream,
  getSignedUrl: mockGetSignedUrl
}));
const mockBucket = jest.fn(() => ({ file: mockFile }));

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: mockBucket }))
}));

jest.mock('../../app/photo_model', () => ({ getFlickrPhotos: jest.fn() }));

const mockSaveJob = jest.fn(() => Promise.resolve('/pierrelouis/when/file'));
jest.mock('../../app/firebase_db', () => ({ saveJob: mockSaveJob }));

const https = require('https');
const archiver = require('archiver');
const photoModel = require('../../app/photo_model');
const zipJob = require('../../app/zip_job');

// --- helpers -------------------------------------------------------------

function httpOk(body) {
  return {
    statusCode: 200,
    resume: jest.fn(),
    on: (event, cb) => {
      if (event === 'data') cb(Buffer.from(body || 'image-bytes'));
      if (event === 'end') cb();
    }
  };
}

function fakeArchive(mode) {
  const archive = new EventEmitter();
  archive.append = jest.fn();
  archive.finalize = jest.fn(() => {
    if (mode === 'error') return archive.emit('error', new Error('archive boom'));
    if (mode === 'warning') return archive.emit('warning', new Error('archive warn'));
    archive.emit('data', Buffer.from('zip-bytes'));
    archive.emit('end');
  });
  return archive;
}

function fakeWriteStream(mode) {
  const stream = new EventEmitter();
  stream.end = jest.fn(() => {
    if (mode === 'error') stream.emit('error', new Error('upload boom'));
    else stream.emit('finish');
  });
  return stream;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GCS_BUCKET = 'ecni22026bucket';
  Object.keys(zipJob.completedJobs).forEach(key => delete zipJob.completedJobs[key]);
});

// --- downloadImage -------------------------------------------------------

describe('downloadImage(url)', () => {
  test('resolves with the response body as a Buffer', () => {
    https.get.mockImplementation((url, cb) => {
      cb(httpOk('hello'));
      return { on: jest.fn() };
    });

    return zipJob.downloadImage('https://x/y.jpg').then(buffer => {
      expect(buffer.toString()).toBe('hello');
    });
  });

  test('follows a redirect', () => {
    https.get
      .mockImplementationOnce((url, cb) => {
        cb({ statusCode: 302, resume: jest.fn(), headers: { location: 'https://x/final.jpg' } });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((url, cb) => {
        expect(url).toBe('https://x/final.jpg');
        cb(httpOk('redirected'));
        return { on: jest.fn() };
      });

    return zipJob.downloadImage('https://x/start.jpg').then(buffer => {
      expect(buffer.toString()).toBe('redirected');
    });
  });

  test('rejects on a non-200 status', () => {
    https.get.mockImplementation((url, cb) => {
      cb({ statusCode: 404, resume: jest.fn(), on: jest.fn() });
      return { on: jest.fn() };
    });

    return zipJob.downloadImage('https://x/missing.jpg').catch(error => {
      expect(error.message).toMatch(/HTTP 404/);
    });
  });

  test('rejects on a request error', () => {
    https.get.mockImplementation(() => ({
      on: (event, cb) => {
        if (event === 'error') cb(new Error('socket reset'));
      }
    }));

    return zipJob.downloadImage('https://x/broken.jpg').catch(error => {
      expect(error.message).toBe('socket reset');
    });
  });
});

// --- buildZip ----------------------------------------------------------

describe('buildZip(files)', () => {
  test('resolves with the concatenated archive buffer', () => {
    archiver.mockReturnValue(fakeArchive());

    return zipJob
      .buildZip([{ name: 'a.jpg', buffer: Buffer.from('a') }])
      .then(buffer => {
        expect(buffer.toString()).toBe('zip-bytes');
      });
  });

  test('rejects on an archive error', () => {
    archiver.mockReturnValue(fakeArchive('error'));

    return zipJob.buildZip([]).catch(error => {
      expect(error.message).toBe('archive boom');
    });
  });

  test('rejects on an archive warning', () => {
    archiver.mockReturnValue(fakeArchive('warning'));

    return zipJob.buildZip([]).catch(error => {
      expect(error.message).toBe('archive warn');
    });
  });
});

// --- uploadZip ---------------------------------------------------------

describe('uploadZip(objectName, buffer)', () => {
  test('resolves once the write stream finishes', () => {
    mockCreateWriteStream.mockReturnValue(fakeWriteStream());

    return zipJob.uploadZip('zips/a.zip', Buffer.from('zip')).then(result => {
      expect(result).toBe('Ok');
      expect(mockBucket).toHaveBeenCalledWith('ecni22026bucket');
      expect(mockFile).toHaveBeenCalledWith('zips/a.zip');
    });
  });

  test('rejects when the write stream errors', () => {
    mockCreateWriteStream.mockReturnValue(fakeWriteStream('error'));

    return zipJob.uploadZip('zips/a.zip', Buffer.from('zip')).catch(error => {
      expect(error.message).toBe('upload boom');
    });
  });
});

// --- processZipRequest -----------------------------------------------

describe('processZipRequest(tags)', () => {
  test('downloads photos, zips them, uploads and records the job', () => {
    const photos = [];
    for (let i = 0; i < 12; i++) {
      photos.push({ media: { b: 'https://x/photo-' + i + '.jpg' } });
    }
    photoModel.getFlickrPhotos.mockReturnValue(Promise.resolve(photos));

    https.get.mockImplementation((url, cb) => {
      cb(httpOk());
      return { on: jest.fn() };
    });
    const archive = fakeArchive();
    archiver.mockReturnValue(archive);
    mockCreateWriteStream.mockReturnValue(fakeWriteStream());

    return zipJob.processZipRequest('trains').then(objectName => {
      expect(objectName).toMatch(/^zips\/[0-9a-f-]+\.zip$/);
      expect(zipJob.completedJobs.trains).toBe(objectName);
      // only the first 10 photos are archived
      expect(archive.append).toHaveBeenCalledTimes(10);
      // the finished job is persisted to Firebase with a signed download URL
      expect(mockSaveJob).toHaveBeenCalledWith(
        'trains',
        objectName,
        'https://signed.example/zip.zip'
      );
    });
  });
});

// --- getSignedUrl --------------------------------------------------

describe('getSignedUrl(objectName)', () => {
  test('returns a read URL that expires in ~2 days', () => {
    return zipJob.getSignedUrl('zips/a.zip').then(url => {
      expect(url).toBe('https://signed.example/zip.zip');

      const options = mockGetSignedUrl.mock.calls[0][0];
      expect(options.action).toBe('read');
      const twoDays = 2 * 24 * 60 * 60 * 1000;
      expect(options.expires).toBeGreaterThan(Date.now() + twoDays - 10000);
      expect(options.expires).toBeLessThanOrEqual(Date.now() + twoDays + 1000);
    });
  });
});
