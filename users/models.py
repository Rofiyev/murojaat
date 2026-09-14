from django.contrib.auth.models import AbstractUser
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

from .validators import validate_file_size


class Address(models.Model):
    id_address = models.AutoField(primary_key=True)
    address_line = models.CharField(max_length=120)
    region = models.CharField(max_length=80)
    city = models.CharField(max_length=80)
    code_postal = models.CharField(max_length=20)

    class Meta:
        verbose_name = "Address"
        verbose_name_plural = "Addresses"

    def __str__(self):
        return self.address_line


class Users(AbstractUser):
    email = models.EmailField(max_length=254, unique=True)
    username = models.CharField(max_length=50, unique=True)
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50)
    gender_choices = (("Male", "Male"), ("Female", "Female"))
    gender = models.CharField(max_length=10, choices=gender_choices, default="Male")
    birthday = models.DateField(null=True, blank=True)
    is_doctor = models.BooleanField(default=False)
    profile_avatar = models.ImageField(
        upload_to="users/profiles",
        blank=True,
        default="doctor/profiles/download.png",
        validators=[
            FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png", "webp"]),
            validate_file_size,
        ],
    )
    id_address = models.ForeignKey(Address, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        verbose_name = "User"
        verbose_name_plural = "Users"

    def __str__(self):
        return self.username


class Reste_token(models.Model):
    """Password reset token record. The token field stores only a SHA-256 digest."""

    user = models.ForeignKey(Users, on_delete=models.CASCADE, related_name="password_reset_tokens")
    email = models.EmailField(max_length=254)
    token = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    def __str__(self):
        return f"Password reset for user #{self.user_id}"


class Specialty(models.Model):
    name = models.CharField(max_length=80, unique=True)
    description = models.TextField()

    class Meta:
        verbose_name = "Specialty"
        verbose_name_plural = "Specialties"

    def __str__(self):
        return self.name


class Doctors(models.Model):
    user = models.OneToOneField(Users, on_delete=models.CASCADE, primary_key=True)
    specialty = models.ForeignKey(Specialty, on_delete=models.PROTECT)
    bio = models.TextField()

    class Meta:
        verbose_name = "Doctor"
        verbose_name_plural = "Doctors"

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class Patients(models.Model):
    user = models.OneToOneField(Users, on_delete=models.CASCADE, primary_key=True)
    insurance = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        verbose_name = "Patient"
        verbose_name_plural = "Patients"

    def __str__(self):
        return self.user.get_full_name() or self.user.username
