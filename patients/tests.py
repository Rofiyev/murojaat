from datetime import timedelta

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from users.models import Address, Doctors, Patients, Specialty, Users
from .models import Appointment, Status, Time


class AppointmentSecurityTests(TestCase):
    def setUp(self):
        address = Address.objects.create(address_line="A", region="B", city="C", code_postal="1")
        specialty = Specialty.objects.create(name="Cardiology", description="test")
        self.doctor_user = Users.objects.create_user(
            username="doctor1", email="doctor1@example.com", password="StrongPass!123",
            first_name="Doc", last_name="One", is_doctor=True, id_address=address,
        )
        self.doctor = Doctors.objects.create(user=self.doctor_user, specialty=specialty, bio="bio")
        self.patient_user = Users.objects.create_user(
            username="patient1", email="patient1@example.com", password="StrongPass!123",
            first_name="Pat", last_name="One", id_address=address,
        )
        self.patient = Patients.objects.create(user=self.patient_user, insurance="x")
        self.time = Time.objects.create(time="09:00")
        self.waited = Status.objects.create(status="Waited")
        self.cancelled = Status.objects.create(status="Cancelled")

    def test_patient_cannot_open_doctor_dashboard(self):
        self.client.force_login(self.patient_user)
        response = self.client.get(reverse("doctor_dashboard"))
        self.assertRedirects(response, reverse("patient_dashboard"))

    def test_doctor_cannot_open_patient_booking(self):
        self.client.force_login(self.doctor_user)
        response = self.client.get(reverse("book_appointment"))
        self.assertRedirects(response, reverse("doctor_dashboard"))

    def test_database_prevents_double_booking(self):
        kwargs = dict(
            doctor=self.doctor, patient=self.patient, summary="A", description="B",
            start_date=timezone.localdate() + timedelta(days=1), time=self.time,
            status=self.waited, slot_reserved=True,
        )
        Appointment.objects.create(**kwargs)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Appointment.objects.create(**kwargs)

    def test_cancelled_slot_can_be_rebooked(self):
        app = Appointment.objects.create(
            doctor=self.doctor, patient=self.patient, summary="A", description="B",
            start_date=timezone.localdate() + timedelta(days=1), time=self.time,
            status=self.cancelled, slot_reserved=False,
        )
        second = Appointment.objects.create(
            doctor=self.doctor, patient=self.patient, summary="C", description="D",
            start_date=app.start_date, time=self.time, status=self.waited, slot_reserved=True,
        )
        self.assertIsNotNone(second.pk)

    def test_past_date_is_rejected_by_booking_view(self):
        self.client.force_login(self.patient_user)
        response = self.client.post(reverse("patient_confirm_book", args=[self.doctor_user.username]), {
            "date": (timezone.localdate() - timedelta(days=1)).isoformat(),
            "time": self.time.time,
            "summary": "test",
            "description": "test",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Appointment.objects.count(), 0)

    def test_patient_dashboard_renders_live_data_view(self):
        self.client.force_login(self.patient_user)
        response = self.client.get(reverse("patient_dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Jami murojaatlar")
