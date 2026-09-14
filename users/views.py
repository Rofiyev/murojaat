import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import redirect, render
from django.utils import timezone

from .helpers import send_reset_email
from .models import Address, Doctors, Patients, Reste_token, Specialty

Users = get_user_model()


def _registration_context(**extra):
    context = {
        "specialities": Specialty.objects.all(),
        "allow_doctor_registration": settings.ALLOW_DOCTOR_SELF_REGISTRATION,
    }
    context.update(extra)
    return context


def register(request):
    if request.user.is_authenticated:
        if getattr(request.user, "is_doctor", False) and hasattr(request.user, "doctors"):
            return redirect("doctor_dashboard")
        if hasattr(request.user, "patients"):
            return redirect("patient_dashboard")

    if request.method == "POST":
        user_status = (request.POST.get("user_config") or "Patient").strip()
        first_name = (request.POST.get("user_firstname") or "").strip()
        last_name = (request.POST.get("user_lastname") or "").strip()
        username = (request.POST.get("user_id") or "").strip()
        email = (request.POST.get("email") or "").strip().lower()
        gender = request.POST.get("user_gender") or "Male"
        birthday = request.POST.get("birthday") or None
        password = request.POST.get("password") or ""
        confirm_password = request.POST.get("conf_password") or ""
        address_line = (request.POST.get("address_line") or "").strip()
        region = (request.POST.get("region") or "").strip()
        city = (request.POST.get("city") or "").strip()
        pincode = (request.POST.get("pincode") or "").strip()
        profile_pic = request.FILES.get("profile_pic")

        preserved = {
            "user_config": user_status,
            "user_firstname": first_name,
            "user_lastname": last_name,
            "user_id": username,
            "email": email,
            "user_gender": gender,
            "address_line": address_line,
            "region": region,
            "city": city,
            "pincode": pincode,
        }

        if user_status not in {"Doctor", "Patient"}:
            messages.error(request, "Noto‘g‘ri foydalanuvchi turi.")
            return render(request, "users/register.html", _registration_context(**preserved))

        if user_status == "Doctor" and not settings.ALLOW_DOCTOR_SELF_REGISTRATION:
            messages.error(request, "Shifokor akkaunti faqat administrator tomonidan yaratiladi.")
            return render(request, "users/register.html", _registration_context(**preserved))

        if not all([first_name, last_name, username, email, address_line, region, city, pincode]):
            messages.error(request, "Majburiy maydonlarni to‘liq kiriting.")
            return render(request, "users/register.html", _registration_context(**preserved))

        if password != confirm_password:
            messages.error(request, "Parollar mos kelmadi.")
            return render(request, "users/register.html", _registration_context(**preserved))

        candidate = Users(username=username, email=email, first_name=first_name, last_name=last_name)
        try:
            validate_password(password, user=candidate)
        except ValidationError as exc:
            for error in exc.messages:
                messages.error(request, error)
            return render(request, "users/register.html", _registration_context(**preserved))

        if Users.objects.filter(username__iexact=username).exists():
            messages.error(request, "Bu login allaqachon mavjud.")
            return render(request, "users/register.html", _registration_context(**preserved))
        if Users.objects.filter(email__iexact=email).exists():
            messages.error(request, "Bu email allaqachon ro‘yxatdan o‘tgan.")
            return render(request, "users/register.html", _registration_context(**preserved))

        try:
            with transaction.atomic():
                address = Address.objects.create(
                    address_line=address_line,
                    region=region,
                    city=city,
                    code_postal=pincode,
                )
                user = Users.objects.create_user(
                    first_name=first_name,
                    last_name=last_name,
                    username=username,
                    email=email,
                    gender=gender,
                    birthday=birthday,
                    password=password,
                    id_address=address,
                    is_doctor=(user_status == "Doctor"),
                )
                if profile_pic:
                    user.profile_avatar = profile_pic
                    user.full_clean(exclude=["password"])
                    user.save(update_fields=["profile_avatar"])

                if user_status == "Doctor":
                    specialty = Specialty.objects.get(name=request.POST.get("Speciality"))
                    Doctors.objects.create(user=user, specialty=specialty, bio=(request.POST.get("bio") or "").strip())
                else:
                    Patients.objects.create(user=user, insurance=(request.POST.get("insurance") or "").strip())
        except (IntegrityError, Specialty.DoesNotExist, ValidationError):
            messages.error(request, "Ro‘yxatdan o‘tishda ma’lumotlarni tekshiring va qayta urinib ko‘ring.")
            return render(request, "users/register.html", _registration_context(**preserved))

        messages.success(request, "Akkaunt yaratildi. Endi tizimga kirishingiz mumkin.")
        return redirect("login")

    return render(request, "users/register.html", _registration_context(user_config="Patient"))


def login_view(request):
    if request.user.is_authenticated:
        if request.user.is_staff:
            return redirect("admin:index")
        if request.user.is_doctor and hasattr(request.user, "doctors"):
            return redirect("doctor_dashboard")
        if hasattr(request.user, "patients"):
            return redirect("patient_dashboard")

    if request.method == "POST":
        username = (request.POST.get("username") or "").strip()
        password = request.POST.get("password") or ""
        user = authenticate(request, username=username, password=password)

        if user is None:
            messages.error(request, "Login yoki parol noto‘g‘ri.")
        elif not user.is_active:
            messages.error(request, "Akkaunt faol emas. Administratorga murojaat qiling.")
        else:
            login(request, user)
            if user.is_staff:
                return redirect("admin:index")
            if user.is_doctor and hasattr(user, "doctors"):
                return redirect("doctor_dashboard")
            if hasattr(user, "patients"):
                return redirect("patient_dashboard")
            logout(request)
            messages.error(request, "Akkaunt roli to‘liq sozlanmagan. Administratorga murojaat qiling.")

    return render(request, "users/login.html")


def forgot_view(request):
    if request.method == "POST":
        email = (request.POST.get("email") or "").strip().lower()
        user = Users.objects.filter(email__iexact=email, is_active=True).first()

        if user:
            raw_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
            Reste_token.objects.filter(user=user).delete()
            Reste_token.objects.create(user=user, email=user.email, token=token_hash)
            reset_url = request.build_absolute_uri(f"/reset/{raw_token}/")
            try:
                send_reset_email(user.email, reset_url)
            except Exception:
                # Do not expose mail infrastructure details to unauthenticated users.
                pass

        # Same response whether the email exists or not prevents account enumeration.
        return render(request, "users/forgot.html", {"send_email_succes": 1})

    return render(request, "users/forgot.html")


def reset_view(request, token):
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    reset_record = Reste_token.objects.select_related("user").filter(token=token_hash).first()
    expired = True
    if reset_record:
        expired = reset_record.created_at < timezone.now() - timedelta(seconds=settings.PASSWORD_RESET_TIMEOUT)

    if not reset_record or expired:
        if reset_record:
            reset_record.delete()
        messages.error(request, "Parolni tiklash havolasi yaroqsiz yoki muddati tugagan.")
        return render(request, "users/reset.html", {"token": token, "invalid_token": True})

    if request.method == "POST":
        password = request.POST.get("password") or ""
        confirm_password = request.POST.get("conf_password") or ""
        if password != confirm_password:
            messages.error(request, "Parollar mos kelmadi.")
            return render(request, "users/reset.html", {"token": token})
        try:
            validate_password(password, user=reset_record.user)
        except ValidationError as exc:
            for error in exc.messages:
                messages.error(request, error)
            return render(request, "users/reset.html", {"token": token})

        user = reset_record.user
        user.set_password(password)
        user.save(update_fields=["password"])
        Reste_token.objects.filter(user=user).delete()
        messages.success(request, "Parol yangilandi. Yangi parol bilan tizimga kiring.")
        return redirect("login")

    return render(request, "users/reset.html", {"token": token})


def logout_view(request):
    if request.user.is_authenticated:
        logout(request)
    return redirect("login")
