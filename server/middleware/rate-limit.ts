import rateLimit from "express-rate-limit";

/**
 * Rate limiter for authentication endpoints (login, register)
 * More restrictive to prevent brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs (Increased slightly for team use)
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip successful requests from counting against the limit
  skipSuccessfulRequests: false,
});

/**
 * Rate limiter for general API endpoints
 * Moderate limits for normal API usage
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs (Increased for active dashboards)
  message: {
    error: "Too many requests from this IP. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for WhatsApp webhook endpoint
 * HIGH CAPACITY for Meta traffic bursts
 */
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3000, // Limit to 3000 requests per minute (~50 req/sec) to handle massive bursts
  message: {
    error: "Webhook rate limit exceeded.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Trust Meta IPs implicitly if possible (requires proxy setup)
});

/**
 * Rate limiter for flow creation/update endpoints
 * Prevent abuse of resource-intensive operations
 */
export const flowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit to 50 flow operations per 15 minutes
  message: {
    error: "Too many flow operations. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for metrics endpoints
 * More lenient for real-time dashboard updates with polling
 * Increased limits to support multiple concurrent users
 */
export const metricsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // Limit to 1000 requests per minute (Support ~100 active users polling every 6s)
  message: {
    error: "Metrics rate limit exceeded. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
