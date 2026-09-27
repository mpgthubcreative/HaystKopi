// Small shared HTTP helpers so every function returns the same shape and
// never leaks a raw error message/stack to the client.

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Thrown deliberately from inside a transaction/handler with a safe,
// customer-facing message and the right HTTP status — caught once at the
// top of each function so there's a single place that maps errors to
// responses.
class RequestError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

module.exports = { respond, RequestError };
