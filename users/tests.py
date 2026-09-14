import hashlib
from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Address, Patients, Reste_token, Users


class AuthenticationSecurityTests(TestCase):
    def setUp(self):
        address = Address.objects.create(address_line="A", region="B", city="C", code_postal="1")
        self.user = Users.objects.create_user(
            username="patient", email="patient@example.com", password="OldStrong!123",
            first_name="Pat", last_name="One", id_address=address,
        )
        Patients.objects.create(user=self.user, insurance="x")

    @override_settings(PASSWORD_RESET_TIMEOUT=1800)
    def test_expired_reset_token_is_rejected(self):
        raw = "test-reset-token"
        digest = hashlib.sha256(raw.encode()).hexdigest()
        Reste_token.objects.create(
            user=self.user, email=self.user.email, token=digest,
            created_at=timezone.now() - timedelta(hours=1),
        )
        response = self.client.get(reverse("reset", args=[raw]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "yaroqsiz yoki muddati tugagan")
        self.assertFalse(Reste_token.objects.filter(token=digest).exists())

    @override_settings(ALLOW_DOCTOR_SELF_REGISTRATION=False)
    def test_public_doctor_registration_is_blocked(self):
        response = self.client.post(reverse("register"), {"user_config": "Doctor"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "faqat administrator")
