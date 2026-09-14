from django.contrib import messages
from django.contrib.auth import get_user_model, update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.core.paginator import Paginator
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from patients.models import Appointment, Status
from users.decorators import doctor_required
from users.models import Address, Doctors, Patients, Specialty
from .models import Blogs, Category, Comments

User = get_user_model()


def _base_template(user):
    return "doctors/base.html" if user.is_doctor and hasattr(user, "doctors") else "patients/base.html"


@doctor_required
def doctor_dashboard(request):
    doctor = request.user.doctors
    blogs = Blogs.objects.filter(doctor=doctor)
    appointments = Appointment.objects.filter(doctor=doctor)
    current_date = timezone.localdate()
    today_appointments = appointments.filter(start_date=current_date).select_related(
        "patient__user", "status", "time"
    ).order_by("time__time")

    return render(request, "doctors/doctor_dashboard.html", {
        "total_blogs": blogs.count(),
        "published_blogs": blogs.filter(is_published=True).count(),
        "draft_blogs": blogs.filter(is_published=False).count(),
        "total_appointments": appointments.count(),
        "accepted_appointments": appointments.filter(status__status="Accepted").count(),
        "waited_appointments": appointments.filter(status__status="Waited").count(),
        "cancelled_appointments": appointments.filter(status__status="Cancelled").count(),
        "today_appointments": today_appointments,
        "today_count": today_appointments.count(),
        "total_patients": appointments.values("patient_id").distinct().count(),
    })


@login_required(login_url="/login/")
def profile(request):
    if not (hasattr(request.user, "doctors") or hasattr(request.user, "patients")):
        messages.error(request, "Akkaunt profili to‘liq sozlanmagan.")
        return redirect("login")

    specialities = Specialty.objects.all()
    updated_profile_successfully = False
    updated_password_successfully = False

    if request.method == "POST":
        if "update_profile" in request.POST:
            user = request.user
            user.first_name = (request.POST.get("user_firstname") or "").strip()
            user.last_name = (request.POST.get("user_lastname") or "").strip()
            user.gender = request.POST.get("user_gender") or user.gender
            user.birthday = request.POST.get("birthday") or None

            address = user.id_address if user.id_address_id else Address()
            address.address_line = (request.POST.get("address_line") or "").strip()
            address.region = (request.POST.get("region") or "").strip()
            address.city = (request.POST.get("city") or "").strip()
            address.code_postal = (request.POST.get("code_postal") or "").strip()

            role_profile = None
            if user.is_doctor and hasattr(user, "doctors"):
                specialty = get_object_or_404(Specialty, name=request.POST.get("Speciality"))
                role_profile = user.doctors
                role_profile.specialty = specialty
                role_profile.bio = (request.POST.get("bio") or "").strip()
            elif hasattr(user, "patients"):
                role_profile = user.patients
                role_profile.insurance = (request.POST.get("insurance") or "").strip()

            old_avatar = user.profile_avatar.name if user.profile_avatar else None
            if "profile_pic" in request.FILES:
                user.profile_avatar = request.FILES["profile_pic"]

            try:
                address.full_clean()
                user.full_clean(exclude=["password", "username", "email", "id_address"])
                if role_profile:
                    role_profile.full_clean(exclude=["user"])

                with transaction.atomic():
                    address.save()
                    user.id_address = address
                    user.save()
                    if role_profile:
                        role_profile.save()
                    if old_avatar and "profile_pic" in request.FILES and old_avatar != user.profile_avatar.name:
                        transaction.on_commit(lambda path=old_avatar: default_storage.delete(path))
                updated_profile_successfully = True
            except ValidationError as exc:
                if hasattr(exc, "message_dict"):
                    for errors in exc.message_dict.values():
                        for error in errors:
                            messages.error(request, error)
                else:
                    for error in exc.messages:
                        messages.error(request, error)

        elif "update_password" in request.POST:
            current_password = request.POST.get("current_password") or ""
            new_password = request.POST.get("new_password") or ""
            confirm_new_password = request.POST.get("confirm_new_password") or ""

            if not request.user.check_password(current_password):
                messages.error(request, "Joriy parol noto‘g‘ri.")
            elif new_password != confirm_new_password:
                messages.error(request, "Yangi parollar mos kelmadi.")
            else:
                try:
                    validate_password(new_password, user=request.user)
                except ValidationError as exc:
                    for error in exc.messages:
                        messages.error(request, error)
                else:
                    request.user.set_password(new_password)
                    request.user.save(update_fields=["password"])
                    update_session_auth_hash(request, request.user)
                    updated_password_successfully = True

    return render(request, "doctors/profile.html", {
        "basicdata": request.user,
        "updated_profile_successfully": updated_profile_successfully,
        "updated_password_successfully": updated_password_successfully,
        "base_template": _base_template(request.user),
        "specialities": specialities,
    })


@login_required(login_url="/login/")
def doctor_blogs(request):
    blogs = Blogs.objects.filter(is_published=True).select_related("doctor__user", "id_category")
    return render(request, "doctors/doctor_blogs.html", {
        "blogs": Paginator(blogs, 5).get_page(request.GET.get("page")),
        "categories": Category.objects.all(),
        "base_template": _base_template(request.user),
    })


@login_required(login_url="/login/")
def search_blogs(request):
    keyword = (request.GET.get("keyword") or "").strip()
    blogs = Blogs.objects.filter(is_published=True, title__icontains=keyword).select_related("doctor__user", "id_category")
    return render(request, "doctors/doctor_blogs.html", {
        "blogs": Paginator(blogs, 5).get_page(request.GET.get("page")),
        "categories": Category.objects.all(),
        "searching": 1,
        "keyword": keyword,
        "base_template": _base_template(request.user),
    })


@login_required(login_url="/login/")
def blogs_category(request, cat):
    category = get_object_or_404(Category, name=cat)
    blogs = Blogs.objects.filter(id_category=category, is_published=True).select_related("doctor__user")
    return render(request, "doctors/doctor_blogs.html", {
        "blogs": Paginator(blogs, 5).get_page(request.GET.get("page")),
        "categories": Category.objects.all(),
        "base_template": _base_template(request.user),
    })


@doctor_required
def upload_blog(request, blog_id=None):
    author = request.user.doctors
    blog = get_object_or_404(Blogs, pk=blog_id, doctor=author) if blog_id else Blogs(doctor=author)

    if request.method == "POST":
        title = (request.POST.get("assign_title") or "").strip()
        category = get_object_or_404(Category, name=request.POST.get("assign_class"))
        description = (request.POST.get("assign_desc") or "").strip()
        summary = (request.POST.get("assign_des") or "").strip()
        new_image = request.FILES.get("assignupload")
        is_published = request.POST.get("upload_blog") == "Submit"

        if not title or not description or not summary:
            messages.error(request, "Sarlavha, tavsif va qisqa mazmunni to‘ldiring.")
        else:
            old_image = blog.thumbnail.name if blog.thumbnail else None
            if new_image:
                blog.thumbnail = new_image
            blog.title = title
            blog.id_category = category
            blog.description = description
            blog.summary = summary
            blog.is_published = is_published
            blog.posted_at = timezone.now()
            try:
                blog.full_clean()
                blog.save()
                if new_image and old_image and old_image != blog.thumbnail.name:
                    transaction.on_commit(lambda: default_storage.delete(old_image))
                messages.success(request, "Blog e'lon qilindi." if is_published else "Blog qoralama sifatida saqlandi.")
                return redirect("myblogs" if is_published else "doctor_drafts")
            except ValidationError as exc:
                for errors in exc.message_dict.values():
                    for error in errors:
                        messages.error(request, error)

    return render(request, "doctors/upload_blog.html", {
        "user_name": request.user.username,
        "total_categories": Category.objects.all(),
        "blog": blog,
    })


@login_required(login_url="/login/")
def view_blog(request, blog_id):
    allowed = Q(is_published=True)
    if request.user.is_doctor and hasattr(request.user, "doctors"):
        allowed |= Q(doctor=request.user.doctors)
    blog = get_object_or_404(Blogs.objects.select_related("doctor__user", "id_category"), allowed, blog_id=blog_id)

    return render(request, "doctors/view_blog.html", {
        "related_blogs": Blogs.objects.filter(id_category=blog.id_category, is_published=True).exclude(blog_id=blog_id)[:3],
        "recent_blogs": Blogs.objects.filter(is_published=True).exclude(blog_id=blog_id)[:5],
        "blog": blog,
        "categories": Category.objects.all(),
        "comments": Comments.objects.filter(blog=blog).select_related("user"),
        "base_template": _base_template(request.user),
    })


@login_required(login_url="/login/")
@require_POST
def post_comment(request):
    content = (request.POST.get("comment") or "").strip()
    blog = get_object_or_404(Blogs, blog_id=request.POST.get("id"), is_published=True)
    if not content:
        messages.error(request, "Izoh bo‘sh bo‘lishi mumkin emas.")
    elif len(content) > 2000:
        messages.error(request, "Izoh 2000 belgidan oshmasligi kerak.")
    else:
        Comments.objects.create(content=content, user=request.user, blog=blog)
    return redirect(reverse("blog", args=[blog.blog_id]))


@doctor_required
def doctor_myblogs(request):
    blogs = Blogs.objects.filter(doctor=request.user.doctors, is_published=True)
    return render(request, "doctors/doctor_blogs.html", {
        "blogs": Paginator(blogs, 5).get_page(request.GET.get("page")),
        "categories": Category.objects.all(),
        "base_template": "doctors/base.html",
    })


@doctor_required
def doctor_drafts(request):
    drafts = Blogs.objects.filter(doctor=request.user.doctors, is_published=False)
    return render(request, "doctors/doctor_drafts.html", {
        "drafts": Paginator(drafts, 5).get_page(request.GET.get("page")),
        "categories": Category.objects.all(),
    })


@doctor_required
def view_appointments(request):
    doctor = request.user.doctors

    if request.method == "POST":
        appointment_id = request.POST.get("app")
        appointment = get_object_or_404(Appointment, id=appointment_id, doctor=doctor)

        if "doctor_response" in request.POST:
            response = (request.POST.get("doctor_response") or "").strip()
            if not response:
                messages.error(request, "Javob matni bo‘sh bo‘lishi mumkin emas.")
            elif len(response) > 5000:
                messages.error(request, "Javob 5000 belgidan oshmasligi kerak.")
            else:
                appointment.doctor_response = response
                appointment.response_date = timezone.now()
                appointment.save(update_fields=["doctor_response", "response_date", "updated_at"])
                messages.success(request, "Bemor murojaatiga javob yuborildi.")
            return redirect("view_appointments")

        status_name = request.POST.get("status")
        if status_name not in {"Accepted", "Waited", "Cancelled"}:
            messages.error(request, "Noto‘g‘ri status.")
            return redirect("view_appointments")

        status_obj = get_object_or_404(Status, status=status_name)
        try:
            with transaction.atomic():
                locked = Appointment.objects.select_for_update().get(pk=appointment.pk, doctor=doctor)
                locked.status = status_obj
                locked.slot_reserved = status_name != "Cancelled"
                locked.save(update_fields=["status", "slot_reserved", "updated_at"])
            messages.success(request, "Murojaat holati yangilandi.")
        except IntegrityError:
            messages.error(request, "Bu vaqtga boshqa faol qabul yozilgan. Statusni qayta faollashtirib bo‘lmaydi.")
        return redirect("view_appointments")

    appointments = Appointment.objects.filter(doctor=doctor).select_related("patient__user", "status", "time")
    filter_status = (request.GET.get("filter_status") or "").strip()
    filter_date = (request.GET.get("filter_date") or "").strip()
    filter_patient_name = (request.GET.get("filter_patient_name") or "").strip()

    if filter_status and filter_status != "All":
        appointments = appointments.filter(status__status=filter_status)
    if filter_date:
        appointments = appointments.filter(start_date=filter_date)
    if filter_patient_name:
        appointments = appointments.filter(
            Q(patient__user__first_name__icontains=filter_patient_name)
            | Q(patient__user__last_name__icontains=filter_patient_name)
        )

    return render(request, "doctors/viewappointments.html", {
        "appointments": appointments,
        "filter_status": filter_status,
        "filter_date": filter_date,
        "filter_patient_name": filter_patient_name,
    })
