import { rateLimit } from 'express-rate-limit';

const errorResponse = {
  success: false,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.'
  }
};

const authErrorResponse = {
  success: false,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many authentication attempts, please try again later.'
  }
};

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: errorResponse
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: authErrorResponse
});
