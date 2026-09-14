from django.contrib import messages
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.dateparse import parse_date

from users.decorators import patient_required
from users.models import Doctors, Patients, Specialty
from .models import Appointment, Status, Time


@patient_required
def patient_dashboard(request):
    patient = request.user.patients
    today = timezone.localdate()
    appointments = Appointment.objects.filter(patient=patient).select_related(
        "doctor__user", "status", "time"
    )
    upcoming = appointments.filter(start_date__gte=today, slot_reserved=True).order_by(
        "start_date", "time__time"
    )[:5]
    return render(request, "patients/patient_dashboard.html", {
        "upcoming_appointments": upcoming,
        "total_appointments": appointments.count(),
        "accepted_appointments": appointments.filter(status__status="Accepted").count(),
        "waited_appointments": appointments.filter(status__status="Waited").count(),
        "answered_appointments": appointments.exclude(doctor_response="").count(),
    })


@patient_required
def my_appointments(request):
    appointments = Appointment.objects.filter(patient__user=request.user).select_related(
        "doctor__user", "status", "time"
    )

    filter_status = (request.GET.get("filter_status") or "").strip()
    filter_date = (request.GET.get("filter_date") or "").strip()
    filter_doctor_name = (request.GET.get("filter_doctor_name") or "").strip()

    if filter_status and filter_status != "All":
        appointments = appointments.filter(status__status=filter_status)
    if filter_date:
        appointments = appointments.filter(start_date=filter_date)
    if filter_doctor_name:
        appointments = appointments.filter(doctor__user__first_name__icontains=filter_doctor_name)

    return render(request, "patients/my_appointments.html", {
        "appointments": appointments,
        "filter_status": filter_status,
        "filter_date": filter_date,
        "filter_doctor_name": filter_doctor_name,
    })


@patient_required
def book_appointment(request):
    specialities = Specialty.objects.all()
    doctors = Doctors.objects.select_related("user", "specialty", "user__id_address")

    filter_speciality = (request.GET.get("filter_speciality") or "").strip()
    filter_city = (request.GET.get("filter_city") or "").strip()
    filter_doctor_name = (request.GET.get("filter_doctor_name") or "").strip()

    if filter_speciality and filter_speciality != "All":
        doctors = doctors.filter(specialty__name=filter_speciality)
    if filter_doctor_name:
        doctors = doctors.filter(user__first_name__icontains=filter_doctor_name)
    if filter_city:
        doctors = doctors.filter(user__id_address__city__icontains=filter_city)

    return render(request, "patients/book_appointment.html", {
        "doctors": doctors,
        "specialities": specialities,
        "filter_speciality": filter_speciality,
        "filter_doctor_name": filter_doctor_name,
        "filter_city": filter_city,
    })


@patient_required
def available_times(request, doctor):
    doctor_obj = get_object_or_404(Doctors, user__username=doctor)
    requested_date = parse_date((request.GET.get("date") or "").strip())
    if not requested_date or requested_date < timezone.localdate():
        return JsonResponse({"times": [], "error": "Noto‘g‘ri sana."}, status=400)

    busy_time_ids = Appointment.objects.filter(
        doctor=doctor_obj,
        start_date=requested_date,
        slot_reserved=True,
    ).values_list("time_id", flat=True)
    times = list(Time.objects.exclude(pk__in=busy_time_ids).values("id", "time"))
    return JsonResponse({"times": times})


@patient_required
def patient_confirm_book(request, doctor):
    doctor_obj = get_object_or_404(Doctors.objects.select_related("user"), user__username=doctor)
    patient = get_object_or_404(Patients, user=request.user)

    if request.method == "POST":
        requested_date = parse_date((request.POST.get("date") or "").strip())
        summary = (request.POST.get("summary") or "").strip()
        description = (request.POST.get("description") or "").strip()
        time_value = (request.POST.get("time") or "").strip()

        if not requested_date or requested_date < timezone.localdate():
            messages.error(request, "O‘tib ketgan yoki noto‘g‘ri sanaga qabul yozib bo‘lmaydi.")
        elif not summary or len(summary) > 250:
            messages.error(request, "Murojaat mavzusini kiriting (250 belgigacha).")
        elif not description or len(description) > 5000:
            messages.error(request, "Murojaat matnini kiriting (5000 belgigacha).")
        else:
            appointment_time = get_object_or_404(Time, time=time_value)
            status = get_object_or_404(Status, status="Waited")
            try:
                with transaction.atomic():
                    Appointment.objects.create(
                        summary=summary,
                        description=description,
                        start_date=requested_date,
                        time=appointment_time,
                        doctor=doctor_obj,
                        patient=patient,
                        status=status,
                        slot_reserved=True,
                    )
                messages.success(request, "Murojaatingiz shifokorga yuborildi.")
                return redirect("my_appointments")
            except IntegrityError:
                messages.error(request, "Bu sana va vaqt band. Boshqa vaqtni tanlang.")

    busy_today = Appointment.objects.filter(
        doctor=doctor_obj,
        start_date=timezone.localdate(),
        slot_reserved=True,
    ).values_list("time_id", flat=True)
    times = Time.objects.exclude(pk__in=busy_today)

    return render(request, "patients/patient_confirm_book.html", {
        "times": times,
        "doctor": doctor_obj,
        "min_date": timezone.localdate().isoformat(),
    })
