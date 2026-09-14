from functools import wraps

from django.contrib import messages
from django.contrib.auth.views import redirect_to_login
from django.shortcuts import redirect


def doctor_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path())
        if not request.user.is_doctor or not hasattr(request.user, "doctors"):
            messages.error(request, "Bu bo‘lim faqat shifokorlar uchun.")
            return redirect("patient_dashboard") if hasattr(request.user, "patients") else redirect("login")
        return view_func(request, *args, **kwargs)
    return wrapper


def patient_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path())
        if request.user.is_doctor or not hasattr(request.user, "patients"):
            messages.error(request, "Bu bo‘lim faqat bemorlar uchun.")
            return redirect("doctor_dashboard") if hasattr(request.user, "doctors") else redirect("login")
        return view_func(request, *args, **kwargs)
    return wrapper
