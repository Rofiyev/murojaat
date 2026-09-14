class SecurityHeadersMiddleware:
    """Add a conservative browser security policy for the HTML application."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault(
            "Content-Security-Policy",
            "; ".join(
                [
                    "default-src 'self'",
                    "base-uri 'self'",
                    "form-action 'self'",
                    "frame-ancestors 'none'",
                    "object-src 'none'",
                    "img-src 'self' data: blob:",
                    "font-src 'self' data:",
                    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
                    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
                    "connect-src 'self'",
                ]
            ),
        )
        response.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response
