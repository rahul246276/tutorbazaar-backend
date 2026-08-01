jest.mock('./logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const { sendEmail } = require('./email');

describe('sendEmail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test('uses Resend when RESEND_API_KEY is configured', async () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_test_123' }),
    });

    await sendEmail({
      to: 'user@example.com',
      subject: 'Password Reset',
      html: '<p>Reset your password</p>',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_123',
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});
