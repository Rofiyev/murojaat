from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from users.models import Doctors, Patients


class Time(models.Model):
    time = models.CharField(max_length=10, unique=True)

    class Meta:
        verbose_name = "Time"
        verbose_name_plural = "Times"
        ordering = ["time"]

    def __str__(self):
        return self.time


class Status(models.Model):
    status = models.CharField(max_length=20, unique=True)

    class Meta:
        verbose_name = "Status"
        verbose_name_plural = "Statuses"

    def __str__(self):
        return self.status


class Appointment(models.Model):
    doctor = models.ForeignKey(Doctors, on_delete=models.PROTECT, related_name="appointments")
    patient = models.ForeignKey(Patients, on_delete=models.PROTECT, related_name="appointments")
    summary = models.CharField(max_length=250, verbose_name="Murojaat mavzusi")
    description = models.TextField(verbose_name="Murojaat matni")
    start_date = models.DateField(db_index=True)
    status = models.ForeignKey(Status, on_delete=models.PROTECT)
    time = models.ForeignKey(Time, on_delete=models.PROTECT)
    slot_reserved = models.BooleanField(default=True, db_index=True)
    doctor_response = models.TextField(blank=True, default="", verbose_name="Vrach javobi")
    response_date = models.DateTimeField(blank=True, null=True, verbose_name="Javob berilgan vaqt")
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Appointment"
        verbose_name_plural = "Appointments"
        ordering = ["-start_date", "time__time"]
        constraints = [
            models.UniqueConstraint(
                fields=["doctor", "start_date", "time"],
                condition=Q(slot_reserved=True),
                name="uniq_reserved_doctor_slot",
            )
        ]
        indexes = [
            models.Index(fields=["doctor", "start_date"]),
            models.Index(fields=["patient", "start_date"]),
        ]

    def clean(self):
        if self.start_date and self.start_date < timezone.localdate():
            raise ValidationError({"start_date": "O‘tib ketgan sanaga qabul yozib bo‘lmaydi."})

    def __str__(self):
        return self.summary
