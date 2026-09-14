from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve as media_serve


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("", include("users.urls")),
    path("", include("doctors.urls")),
    path("", include("patients.urls")),
    # Small internal deployment convenience. In larger deployments, serve MEDIA_ROOT
    # from object storage or a dedicated reverse proxy.
    re_path(r"^media/(?P<path>.*)$", media_serve, {"document_root": settings.MEDIA_ROOT}),
]
