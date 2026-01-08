from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

class ManualCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            response = Response()
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = "POST, GET, DELETE, PUT, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.status_code = 200
            return response

        response = await call_next(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
